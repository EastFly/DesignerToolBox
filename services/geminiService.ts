import { GoogleGenAI } from "@google/genai";
import { AiModelType } from "../types";

export const MODELS: Record<string, AiModelType> = {
    TEXT: 'gemini-3-flash-preview',
    PRO: 'gemini-3.1-pro-preview',
    IMAGE: 'gemini-3.1-flash-image-preview',
    PRO_IMAGE: 'gemini-3-pro-image-preview'
};

/**
 * Safely retrieves the API key from various possible sources.
 * Prioritizes hardcoded env, then runtime injected env, then platform dialog.
 */
export async function getApiKey(): Promise<string> {
    // 1. Try GEMINI_API_KEY (usually from .env via Vite define)
    let apiKey = (process.env.GEMINI_API_KEY as string) || '';
    
    // 2. Try dynamic process.env.API_KEY (platform injected)
    // We use a safe check to avoid ReferenceError in browser
    if (!apiKey) {
        try {
            // @ts-ignore
            apiKey = window.process?.env?.GEMINI_API_KEY || window.process?.env?.API_KEY || '';
        } catch (e) {}
    }

    // 3. Fallback to platform selection dialog
    if (!apiKey && typeof window !== 'undefined' && (window as any).aistudio) {
        const aistudio = (window as any).aistudio;
        try {
            if (await aistudio.hasSelectedApiKey()) {
                // Re-check after selection
                // @ts-ignore
                apiKey = window.process?.env?.GEMINI_API_KEY || window.process?.env?.API_KEY || '';
            } else {
                await aistudio.openSelectKey();
                // @ts-ignore
                apiKey = window.process?.env?.GEMINI_API_KEY || window.process?.env?.API_KEY || '';
            }
        } catch (e) {
            console.error("Key selection failed", e);
        }
    }
    
    return apiKey;
}

/**
 * Creates a GoogleGenAI instance with the best available API key.
 */
export async function createAIInstance() {
    const apiKey = await getApiKey();
    if (!apiKey) {
        throw new Error("API Key is required. Please ensure you have configured an API key or selected one via the dialog.");
    }
    return new GoogleGenAI({ apiKey });
}

/**
 * Handles common Gemini errors, specifically key-related ones.
 */
export async function handleGeminiError(error: any) {
    console.error("Gemini API Error:", error);
    const msg = error.message || "";
    
    // If key is invalid or not found, prompt for selection
    if (msg.includes("Requested entity was not found") || 
        msg.includes("API key not found") || 
        msg.includes("invalid API key")) {
        if (typeof window !== 'undefined' && (window as any).aistudio) {
            await (window as any).aistudio.openSelectKey();
        }
    }
    throw error;
}
