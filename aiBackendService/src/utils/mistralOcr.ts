import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const apiKey = process.env.MISTRAL_API_KEY;
const client = new Mistral({ apiKey });

/**
 * Uploads a file (Buffer) to Mistral and triggers the OCR process
 * It returns the markdown content extracted from the document
 */
export async function extractTextWithMistralOcr(fileName: string, fileBuffer: Buffer): Promise<string> {
    const isDev = process.env.NODE_ENV === 'dev' || process.env.NODE_ENV === 'development';
    const cacheDir = path.join(process.cwd(), 'cache');
    const safeFileName = fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const cachePath = path.join(cacheDir, `${safeFileName}.md`);

    if (isDev) {
        if (fs.existsSync(cachePath)) {
            console.log(`[MistralOCR] Dev cache hit. Loading from ${cachePath}`);
            return fs.readFileSync(cachePath, 'utf8');
        }
    }

    if (!apiKey) {
        throw new Error("MISTRAL_API_KEY is not defined in the environment.");
    }

    try {
        console.log(`[MistralOCR] Uploading file '${fileName}' to Mistral...`);
        const uploadedFile = await client.files.upload({
            file: {
                fileName: fileName,
                content: fileBuffer,
            },
            purpose: "ocr",
        });

        console.log(`[MistralOCR] File uploaded successfully. ID: ${uploadedFile.id}. Processing OCR...`);

        const ocrResponse = await client.ocr.process({
            model: "mistral-ocr-latest",
            document: {
                type: "file",
                fileId: uploadedFile.id
            },
        });

        console.log(`[MistralOCR] OCR process completed.`);

        // Combine all pages' markdown content
        const pages = ocrResponse.pages || [];
        const markdownContent = pages.map(page => page.markdown).join('\n\n');

        if (isDev) {
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            fs.writeFileSync(cachePath, markdownContent, 'utf8');
            console.log(`[MistralOCR] Saved result to cache at ${cachePath}`);
        }

        // Best practice: Delete the file after processing
        try {
            await client.files.delete({ fileId: uploadedFile.id });
            console.log(`[MistralOCR] File ${uploadedFile.id} deleted from Mistral storage.`);
        } catch (delError) {
            console.error(`[MistralOCR] Failed to delete file ${uploadedFile.id}.`, delError);
        }

        return markdownContent;
    } catch (error) {
        console.error("[MistralOCR] Error during OCR process:", error);
        throw error;
    }
}
