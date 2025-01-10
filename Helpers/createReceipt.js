import fs from "fs";
import { v4 as uuid } from "uuid";[]
import { ThrowError } from "./Helpers.js";


export const createReceipt = async (str, accountID)=> {
    
    // If the string is empty or does not contain ";base64," return the string as is.
    if (!str) return "";
    if (!str.includes(";base64,")) return str;

    // Split the base64 string into its parts.
    const b64Parts = str.split(";base64,");

    // Extract the file extension from the first part.
    const ext = b64Parts[0].split("/")[1];

    // Extract the base64 image from the second part.
    let base64Image = b64Parts[1];

    // Generate a unique file name using the account ID and the file extension.
    const path = uuid() + "." + ext;

    // Add the account ID to the file path if it does not already contain a forward slash.
    let accountIDx = "" + accountID;
    if (!accountIDx.includes("/")) accountIDx = accountID + "/";
    // Create the directory for the account if it does not already exist.
    if (!fs.existsSync(imageDir + accountIDx)) {
        try {
            fs.mkdirSync(imageDir + accountIDx, { recursive: true });
        } catch (err) {
            // log('base64ToFile', err);
        }
    }

    // Write the base64 image to the file system.
    try {
        fs.writeFileSync(imageDir + accountIDx + path, base64Image, {
            encoding: "base64",
        });
    } catch (err) {
        // log('base64ToFile', err);
        ThrowError("An error occured while trying to save image.");
    }

    // Return the file path.
    return accountIDx + path;
};