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
        required:true,
    },
    verified: {
        type: Boolean,
        default: false,   // set to true after step 2 (verifyResetToken)
    },
    sessionHash: {
        type: String,     // SHA-256 of the resetSession nonce issued in step 2
        default: null,
    },
    // Reset to now every time a code is (re)issued, which restarts the TTL.
    // No `timestamps` option: it would make createdAt immutable and silently
    // drop that reset, so a resent code could expire minutes after arriving.
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 900, // 15 minutes TTL (MongoDB auto-deletes)
    },
});

//Export the model
module.exports = mongoose.model('Token', tokenSchema);