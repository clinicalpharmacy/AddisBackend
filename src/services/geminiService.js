import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

/**
 * Gemini AI Service for Clinical Decision Support (CDSS).
 * Primary: gemini-2.5-flash-lite (Ultra low-cost)
 * Fallback: gemini-1.5-flash (Stable)
 */
export async function analyzePatientCDSS(patientData, attempts = 0) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured.");

    // Define models in order of preference
    const models = ["gemini-2.5-flash-lite", "gemini-1.5-flash"];
    const model = models[attempts] || models[models.length - 1];

    try {
        console.log(`[Gemini AI] Requesting: ${model} (Clinical Reasoning)`);

        const response = await axios.post(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
                contents: [
                    {
                        parts: [
                            {
                                text: `You are an expert Clinical Decision Support System (CDSS) for clinical pharmacists. 
                                Analyze this patient data: ${JSON.stringify(patientData)}. 
                                
                                Identify Drug Therapy Problems (DTPs), monitoring needs, and clinical goals. 
                                Provide evidence-based advice even if data is limited.
                                
                                Return ONLY a valid JSON object with this exact structure:
                                {
                                    "summary": "...", 
                                    "dtp": [{"category": "...", "problem": "...", "recommendation": "..."}], 
                                    "dose_adjustments": [{"medication": "...", "reason": "...", "suggested_dose": "..."}], 
                                    "monitoring": ["..."], 
                                    "citations": ["..."]
                                }`
                            }
                        ]
                    }
                ],
                generationConfig: {
                    responseMimeType: "application/json",
                    temperature: 0.1
                }
            },
            {
                headers: { "Content-Type": "application/json" },
                timeout: 60000
            }
        );

        if (!response.data.candidates || response.data.candidates.length === 0) {
            throw new Error("Gemini AI returned no candidates.");
        }

        const content = response.data.candidates[0].content.parts[0].text;
        return JSON.parse(content);

    } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;

        // If high demand (503) or rate limit (429) and we have a fallback model
        if ((status === 503 || status === 429) && attempts < (models.length - 1)) {
            console.warn(`[Gemini AI Warning] ${model} unavailable (Status ${status}). Falling back to ${models[attempts + 1]}...`);
            return analyzePatientCDSS(patientData, attempts + 1);
        }

        if (error.response) {
            console.error(`[Gemini API Error] Status ${status}:`, JSON.stringify(data, null, 2));
            throw new Error(`Gemini AI failed (${model}): ${data?.error?.message || "Unknown error"}`);
        }
        console.error(`[Gemini Connection Error]:`, error.message);
        throw new Error(`Gemini Connection Error: ${error.message}`);
    }
}
