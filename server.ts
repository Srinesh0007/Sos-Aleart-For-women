import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import twilio from "twilio";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Trust the reverse proxy (Nginx) to correctly identify HTTPS
  app.set('trust proxy', 1);

  // Ensure evidence directory exists
  const evidenceDir = path.resolve(__dirname, "evidence");
  if (!fs.existsSync(evidenceDir)) {
    fs.mkdirSync(evidenceDir, { recursive: true });
  }

  app.use(express.json({ limit: '50mb' }));
  
  // Serve evidence with explicit headers
  app.use('/evidence', (req, res, next) => {
    if (req.query.download) {
      const fileName = path.basename(req.url.split('?')[0]);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }
    next();
  }, express.static(evidenceDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.jpg' || ext === '.jpeg') res.setHeader('Content-Type', 'image/jpeg');
      if (ext === '.webm') res.setHeader('Content-Type', 'audio/webm');
      if (ext === '.ogg') res.setHeader('Content-Type', 'audio/ogg');
      if (ext === '.mp4') res.setHeader('Content-Type', 'audio/mp4');
      
      // Add cross-origin headers just in case
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
    }
  }));

  // API to upload evidence
  app.post("/api/evidence/upload", (req, res) => {
    const { id, type, data, timestamp } = req.body;
    
    if (!id || !type || !data) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Extract extension from data URL if possible, otherwise fallback
    let extension = type === 'photo' ? 'jpg' : type === 'video' ? 'webm' : 'webm';
    const match = data.match(/^data:(audio|video)\/(\w+);/);
    if (match && match[2]) {
      extension = match[2];
    }
    
    // Use type in filename to easily identify it later: type_id_timestamp.ext
    const fileName = `${type}_${id}_${new Date(timestamp).getTime()}.${extension}`;
    const filePath = path.join(evidenceDir, fileName);

    try {
      // Decode base64 and save. Use split('base64,') instead of split(',') 
      // because mime types can contain commas (e.g., codecs=vp8,opus)
      const base64Parts = data.split('base64,');
      const base64Data = base64Parts.length > 1 ? base64Parts[1] : null;
      
      if (base64Data) {
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.log(`Saved evidence: ${fileName} to ${filePath}`);
        const fileUrl = `/evidence/${fileName}`;
        res.json({ success: true, url: fileUrl });
      } else {
        console.error("Invalid data format for upload");
        res.status(400).json({ error: "Invalid data format" });
      }
    } catch (error) {
      console.error("Error saving file:", error);
      res.status(500).json({ error: "Failed to save evidence" });
    }
  });

  // API to list evidence
  app.get("/api/evidence", (req, res) => {
    try {
      const files = fs.readdirSync(evidenceDir);
      const evidenceList = files
        .filter(file => file.includes('_'))
        .map(file => {
          const parts = file.split('_');
          if (parts.length < 2) return null;
          
          let id, type, timestampStr;
          if (parts.length >= 3) {
            // New format: type_id_timestamp.ext
            type = parts[0];
            id = parts[1];
            timestampStr = parts[2].split('.')[0];
          } else {
            // Old format: id_timestamp.ext
            id = parts[0];
            timestampStr = parts[1].split('.')[0];
            const ext = path.extname(file).toLowerCase();
            type = (ext === '.jpg' || ext === '.jpeg') ? 'photo' : 'audio';
          }
          
          const timestamp = parseInt(timestampStr);
          if (isNaN(timestamp)) return null;
          
          return {
            id,
            type,
            timestamp: new Date(timestamp),
            url: `/evidence/${file}`
          };
        })
        .filter(item => item !== null);
      res.json(evidenceList);
    } catch (error) {
      console.error("Error listing evidence:", error);
      res.status(500).json({ error: "Failed to list evidence" });
    }
  });

  // API to delete evidence
  app.delete("/api/evidence", (req, res) => {
    const deleteAll = req.query.all === 'true';
    const fileName = req.query.file as string;

    if (deleteAll) {
      try {
        if (!fs.existsSync(evidenceDir)) {
          return res.json({ success: true, count: 0 });
        }
        const files = fs.readdirSync(evidenceDir);
        let deletedCount = 0;
        let errorCount = 0;

        for (const file of files) {
          const parts = file.split('_');
          // Match the filtering logic in the GET route: must have at least one underscore
          // and the parts must be valid for our evidence mapping.
          if (parts.length < 2) continue;

          const filePath = path.join(evidenceDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.isFile()) {
              fs.unlinkSync(filePath);
              deletedCount++;
            }
          } catch (fileErr) {
            console.error(`Error deleting file ${file}:`, fileErr);
            errorCount++;
          }
        }
        // Return result without verbose logging that might be mistaken for errors
        return res.json({ 
          success: true, 
          count: deletedCount, 
          errors: errorCount > 0 ? errorCount : undefined 
        });
      } catch (error) {
        console.error("Error in delete all evidence:", error);
        return res.status(500).json({ error: "Failed to process delete all request" });
      }
    }

    if (!fileName) {
      return res.status(400).json({ error: "Missing file parameter or all=true" });
    }
    
    const filePath = path.join(evidenceDir, fileName);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted evidence: ${fileName}`);
        res.json({ success: true });
      } else {
        console.warn(`File not found for deletion: ${filePath}`);
        res.status(404).json({ error: "File not found" });
      }
    } catch (error) {
      console.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete evidence" });
    }
  });

  // API to send SOS notifications via Twilio
  app.post("/api/sos/notify", async (req, res) => {
    const { contacts, location, message } = req.body;
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return res.status(400).json({ 
        success: false, 
        error: "SMS service not configured. Please set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in environment variables." 
      });
    }

    try {
      const client = twilio(accountSid, authToken);
      const results = [];

      for (const contact of contacts) {
        try {
          const body = `EMERGENCY SOS from ${message || 'StealthSOS'}. Location: https://www.google.com/maps?q=${location.lat},${location.lng}`;
          const msg = await client.messages.create({
            body,
            from: fromNumber,
            to: contact.phone
          });
          results.push({ contact: contact.name, sid: msg.sid, status: 'sent' });
        } catch (err: any) {
          console.error(`Failed to send SMS to ${contact.name}:`, err);
          results.push({ contact: contact.name, error: err.message, status: 'failed' });
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Twilio client error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
