const mongoose = require('mongoose'); // Erase if already required

// Declare the Schema of the Mongo model
var tokenSchema = new mongoose.Schema({
    email:{
        type:String,
        required:true,
        unique:true,
        index:true,
    },
    code:{
        type:String,
        length:6,
        required:true,
    },
});

//Export the model
module.exports = mongoose.model('Token', tokenSchema);