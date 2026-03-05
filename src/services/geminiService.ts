import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function analyzeDangerFromAudio(audioBase64: string): Promise<{ danger: boolean; confidence: number; reason: string }> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "audio/wav",
            data: audioBase64,
          },
        },
        {
          text: "Analyze this audio for signs of immediate physical danger, distress, or SOS keywords like 'help', 'stop', 'leave me'. Return JSON: { danger: boolean, confidence: number, reason: string }",
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const result = JSON.parse(response.text || "{}");
    return {
      danger: result.danger || false,
      confidence: result.confidence || 0,
      reason: result.reason || "No danger detected",
    };
  } catch (error) {
    console.error("Error analyzing audio:", error);
    return { danger: false, confidence: 0, reason: "Analysis failed" };
  }
}

export async function analyzeDangerFromImage(imageBase64: string): Promise<{ danger: boolean; confidence: number; reason: string }> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: imageBase64,
          },
        },
        {
          text: "Analyze this image for signs of physical violence, weapons, or distress. Return JSON: { danger: boolean, confidence: number, reason: string }",
        },
      ],
      config: {
        responseMimeType: "application/json",
      },
    });

    const result = JSON.parse(response.text || "{}");
    return {
      danger: result.danger || false,
      confidence: result.confidence || 0,
      reason: result.reason || "No danger detected",
    };
  } catch (error) {
    console.error("Error analyzing image:", error);
    return { danger: false, confidence: 0, reason: "Analysis failed" };
  }
}
