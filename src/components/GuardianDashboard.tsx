import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Shield, MapPin, Download, RefreshCw, Trash2, FileAudio, FileVideo, Image as ImageIcon, X } from 'lucide-react';
import { Evidence } from '../types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface GuardianDashboardProps {
  onClose: () => void;
}

export default function GuardianDashboard({ onClose }: GuardianDashboardProps) {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);

  const fetchEvidence = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/evidence');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      const formattedData = data.map((item: any) => ({
        ...item,
        timestamp: new Date(item.timestamp)
      })).sort((a: any, b: any) => b.timestamp.getTime() - a.timestamp.getTime());
      setEvidence(formattedData);
    } catch (err) {
      console.error("Failed to fetch evidence:", err);
      // Optionally set empty evidence on error or show a user-friendly message
      // setEvidence([]); 
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvidence();
    // Poll for new evidence every 10 seconds
    const interval = setInterval(fetchEvidence, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleDelete = async (id: string, url: string) => {
    if (!confirm("Are you sure you want to delete this evidence? This action cannot be undone.")) return;
    
    // Extract filename properly, handling potential URL encoding in the URL itself
    let fileName = '';
    try {
      // Create a URL object to easily parse the pathname
      // Use window.location.origin as base if url is relative
      const urlObj = new URL(url, window.location.origin);
      // Get the last part of the path
      fileName = urlObj.pathname.split('/').pop() || '';
      // Decode it just in case it was double encoded or similar
      fileName = decodeURIComponent(fileName);
    } catch (e) {
      // Fallback for simple string manipulation if URL parsing fails
      const cleanUrl = url.split('#')[0].split('?')[0];
      fileName = cleanUrl.split('/').pop() || '';
      fileName = decodeURIComponent(fileName);
    }

    if (!fileName) {
      alert("Could not determine filename to delete.");
      return;
    }

    try {
      // Send the filename as a query parameter
      const response = await fetch(`/api/evidence?file=${encodeURIComponent(fileName)}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        setEvidence(prev => prev.filter(item => item.id !== id));
      } else {
        alert("Failed to delete evidence: " + (result.error || "Unknown error"));
      }
    } catch (error) {
      console.error("Error deleting evidence:", error);
      alert("Error deleting evidence. Please try again.");
    }
  };

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const zip = new JSZip();
      const folder = zip.folder("evidence");
      
      if (!folder) return;

      // Add a manifest file
      const manifest = {
        exportedAt: new Date().toISOString(),
        totalFiles: evidence.length,
        files: evidence.map(e => ({
          id: e.id,
          type: e.type,
          timestamp: e.timestamp.toISOString(),
          filename: e.url.split('/').pop()
        }))
      };
      folder.file("manifest.json", JSON.stringify(manifest, null, 2));

      // Download each file and add to zip
      await Promise.all(evidence.map(async (item) => {
        try {
          const response = await fetch(item.url);
          const blob = await response.blob();
          const filename = item.url.split('/').pop() || `evidence_${item.id}`;
          folder.file(filename, blob);
        } catch (e) {
          console.error(`Failed to download ${item.url}`, e);
        }
      }));

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `guardian_evidence_${new Date().toISOString().split('T')[0]}.zip`);
    } catch (err) {
      console.error("Failed to create zip:", err);
      alert("Failed to create zip file.");
    } finally {
      setDownloading(false);
    }
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: true
    }).format(date);
  };

  return (
    <div className="h-full w-full bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <Shield className="text-blue-500" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold">Guardian Dashboard</h1>
            <p className="text-xs text-zinc-400">Live Evidence Feed</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Actions */}
        <div className="flex gap-4">
          <button 
            onClick={fetchEvidence}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
          <button 
            onClick={handleDownloadZip}
            disabled={downloading || evidence.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-500 transition-colors disabled:opacity-50 ml-auto"
          >
            <Download size={18} />
            {downloading ? "Creating Zip..." : "Download All Evidence (Zip)"}
          </button>
        </div>

        {/* Evidence Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {evidence.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden group"
            >
              <div className="aspect-video bg-black relative flex items-center justify-center">
                {item.type === 'photo' ? (
                  <img 
                    src={item.url} 
                    alt="Evidence" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : item.type === 'video' ? (
                  <video 
                    src={item.url} 
                    controls 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                    <FileAudio size={48} className="text-zinc-600" />
                    <audio src={item.url} controls className="absolute bottom-4 left-4 right-4" />
                  </div>
                )}
                
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 backdrop-blur-md rounded text-xs font-mono border border-white/10">
                  {item.type.toUpperCase()}
                </div>
              </div>
              
              <div className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="text-sm font-bold text-zinc-200">
                      {formatTime(item.timestamp)}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {item.timestamp.toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a 
                      href={item.url} 
                      download 
                      className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
                      title="Download File"
                    >
                      <Download size={16} />
                    </a>
                    <button 
                      onClick={() => handleDelete(item.id, item.url)}
                      className="p-2 hover:bg-red-900/30 rounded-lg transition-colors text-zinc-400 hover:text-red-500"
                      title="Delete Evidence"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
          
          {evidence.length === 0 && !loading && (
            <div className="col-span-full py-12 text-center text-zinc-500">
              No evidence collected yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
