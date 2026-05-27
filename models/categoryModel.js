const mongoose = require('mongoose'); // Erase if already required

// Declare the Schema of the Mongo model
var categorySchema = new mongoose.Schema({
    name:{
        type:String,
        required:true,
        unique:true,
        index:true,
    },
    image:{
        type:String,          // Cloudinary URL — upload via POST /api/upload/signature (folder: categories)
        default: null,
    },
});

//Export the model
module.exports = mongoose.model('Category', categorySchema);