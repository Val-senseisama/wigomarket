const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

const generateSignature = (req, res) => {
  try {
    const { folder } = req.body;
    const timestamp = Math.round(new Date().getTime() / 1000);

    const signatureParameters = {
      timestamp,
      ...(folder && { folder }),
    };

    const signature = cloudinary.utils.api_sign_request(
      signatureParameters,
      process.env.CLOUDINARY_API_SECRET
    );

    res.status(200).json({
      timestamp,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      ...(folder && { folder }),
    });
  } catch (error) {
    console.error("Error generating signature:", error);
    res.status(500).json({ msg: "Error generating signature", error: error.message });
  }
};

module.exports = {
  generateSignature,
};
