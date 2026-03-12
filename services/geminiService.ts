import { GoogleGenAI } from "@google/genai";
import { AiModelType } from "../types";

export const MODELS: Record<string, AiModelType> = {
    TEXT: 'gemini-3-flash-preview',
    PRO: 'gemini-3.1-pro-preview',
    IMAGE: 'gemini-3.1-flash-image-preview',
    PRO_IMAGE: 'gemini-3-pro-image-preview'
};

/**
 * Safely retrieves the API key.
 */
export async function getApiKey(): Promise<string> {
    let key = '';
    
    // 1. Try Vite's import.meta.env (if user used VITE_ prefix)
    try {
        key = import.meta.env.VITE_GEMINI_API_KEY || import.meta.env.VITE_API_KEY || '';
    } catch (e) {}

    // 2. Try statically replaced process.env (from vite.config.ts define)
    if (!key) {
        try {
            // @ts-ignore
            if (typeof process !== 'undefined' && process.env) {
                key = process.env.GEMINI_API_KEY || process.env.API_KEY || '';
            }
        } catch (e) {}
    }

    // 3. Fallback for direct Vite replacement if process is undefined
    if (!key) {
        try {
            // @ts-ignore
            key = process.env.GEMINI_API_KEY || '';
        } catch (e) {}
    }
    if (!key) {
        try {
            // @ts-ignore
            key = process.env.API_KEY || '';
        } catch (e) {}
    }

    // 4. Try dynamic window access (bypasses Vite's static replacement for runtime injection)
    if (!key) {
        try {
            const win = window as any;
            if (win && win.process && win.process.env) {
                key = win.process.env.GEMINI_API_KEY || win.process.env.API_KEY || '';
            }
        } catch (e) {}
    }

    return key;
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
 * Handles common Gemini errors.
 */
export async function handleGeminiError(error: any) {
    console.error("Gemini API Error:", error);
    throw error;
}
