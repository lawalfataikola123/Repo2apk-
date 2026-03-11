import { GoogleGenAI } from "@google/genai";

let ai: GoogleGenAI | null = null;

export const analyzeRepo = async (repoUrl: string) => {
  try {
    if (!ai) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        console.warn("GEMINI_API_KEY is not set. Falling back to default detection.");
        return "gradle";
      }
      ai = new GoogleGenAI({ apiKey });
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze this GitHub repository URL: ${repoUrl}. 
      Based on the URL and common naming conventions, what is the most likely project type?
      Choose from: 'gradle', 'flutter', or 'react-native'.
      Return ONLY the lowercase string of the type.`,
    });
    const text = response.text?.trim().toLowerCase() || "";
    if (['gradle', 'flutter', 'react-native'].includes(text)) {
      return text;
    }
    return "gradle"; // Default fallback
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return "gradle";
  }
};
