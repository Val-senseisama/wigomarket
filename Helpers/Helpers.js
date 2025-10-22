const DateTime = require("luxon").DateTime;
const fs = require("fs");
const path = require("path");


 const ThrowError = (message) => {
	throw new Error(message, {
		extensions: { code: "USER" },
	});
};


const MakeID = (length) => {
	var result = "";
	var characters = "ABCDEFGHJKLMNPQRTUVWXY346789";
	var charactersLength = characters.length;
	for (var i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
};

// create a function to generate uuid v4
const uuid = () => {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
		var r = (Math.random() * 16) | 0,
			v = c == "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
};

const base64ToFile = (str, folder) => {
	if (typeof str !== 'string') {
		throw new Error('Input must be a string');
	}
	if (!str) return "";
	if (!str.includes(";base64,")) return str;
	const b64Parts = str.split(";base64,");
	const ext = b64Parts[0].split("/")[1];
	let base64File = b64Parts[1];
	console.log("creating file");
	
	const path = uuid() + "." + ext;
	let folderPath = folder;
	if (!folderPath.includes("/")) folderPath = folderPath + "/";

	if (!fs.existsSync(UploadDir + folderPath)) {
		try {
			fs.mkdirSync(UploadDir + folderPath, { recursive: true });
		} catch (err) {
			console.log("base64ToFile2", err);
			log('base64ToFile', err);
		}
	}

	try {
		fs.writeFileSync(UploadDir + folderPath + path, base64File, {
			encoding: "base64",
		});
	} catch (err) {
		console.log("base64ToFile3", err);
		log('base64ToFile', err);
		ThrowError("An error occured while trying to save file.");
	}

	return folderPath + path;
};

const emailBase64ToFile = (base64String, directory, filename) => {
	if (typeof base64String !== 'string') {
		throw new Error('Input must be a string');
	}
	if (!base64String) return "";

	let folderPath = directory;
	if (!folderPath.includes("/")) folderPath = folderPath + "/";

	if (!fs.existsSync(UploadDir + folderPath)) {
		try {
			fs.mkdirSync(UploadDir + folderPath, { recursive: true });
		} catch (err) {
			console.log("base64ToFile2", err);
			log('base64ToFile', err);
		}
	}
	
	fs.writeFileSync(UploadDir + folderPath + filename, base64String, {
		encoding: "base64",
	});
	return folderPath + filename;
  }




// const SaveAuditTrail = async (data: AuditTrailType): Promise<void> => {
// 	// Set default values for optional properties
// 	data.ip_address = data.ip_address || "";
// 	data.created_at = data.created_at || DateTime.now().toSQL();

// 	// Remove properties that are no longer part of AuditTrailType
// 	const {
// 		user_id,
// 		task,
// 		details,
// 		ip_address,
// 		created_at
// 	} = data;

// 	const auditTrailData = {
// 		user_id,
// 		task,
// 		details,
// 		ip_address,
// 		created_at
// 	};

// 	pendingAuditTrails.push(auditTrailData);
// 	if (pendingAuditTrails.length > CONFIG.settings.MAX_LOG_STACK) {
// 		await commitMemory();
// 	}
// };

module.exports = {ThrowError, MakeID, emailBase64ToFile, base64ToFile, uuid}