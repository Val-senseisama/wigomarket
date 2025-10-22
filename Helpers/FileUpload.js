import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');

export const saveFile = async (base64String, fileName)=> {
  try {
    // Ensure the uploads directory exists
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Extract file extension from the original filename
    const fileExtension = path.extname(fileName);
    
    // Generate a unique filename
    const uniqueFileName = `${uuidv4()}${fileExtension}`;
    const filePath = path.join(uploadDir, uniqueFileName);

    // Remove the base64 header if present
    const base64Data = base64String.replace(/^data:.*?;base64,/, '');
    
    // Write the file
    await fs.promises.writeFile(filePath, base64Data, 'base64');

    // Return the relative path that will be used as URL
    return `/uploads/${uniqueFileName}`;
  } catch (error) {
    console.error('Error saving file:', error);
    throw new Error('Failed to save file');
  }
};
