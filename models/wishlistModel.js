const mongoose = require("mongoose");

// Wishlist schema for users to save products
const wishlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  products: [{
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    notes: {
      type: String,
      maxlength: 500
    }
  }],
  // Wishlist metadata
  totalItems: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  // Privacy settings
  isPublic: {
    type: Boolean,
    default: false
  },
  name: {
    type: String,
    default: "My Wishlist",
    maxlength: 100
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
wishlistSchema.index({ user: 1 });
wishlistSchema.index({ "products.product": 1 });
wishlistSchema.index({ lastUpdated: -1 });

// Virtual for checking if product is in wishlist
wishlistSchema.virtual('hasProductCheck').get(function() {
  return (productId) => {
    return this.products.some(item => item.product.toString() === productId.toString());
  };
});

// Pre-save middleware to update totalItems
wishlistSchema.pre('save', function(next) {
  this.totalItems = this.products.length;
  this.lastUpdated = new Date();
  next();
});

// Method to add product to wishlist
wishlistSchema.methods.addProduct = function(productId, notes = '') {
  // Check if product already exists
  const existingProduct = this.products.find(item => 
    item.product.toString() === productId.toString()
  );
  
  if (existingProduct) {
    throw new Error('Product already in wishlist');
  }
  
  this.products.push({
    product: productId,
    addedAt: new Date(),
    notes: notes
  });
  
  return this.save();
};

// Method to remove product from wishlist
wishlistSchema.methods.removeProduct = function(productId) {
  this.products = this.products.filter(item => 
    item.product.toString() !== productId.toString()
  );
  
  return this.save();
};

// Method to check if product is in wishlist
wishlistSchema.methods.hasProduct = function(productId) {
  return this.products.some(item => 
    item.product.toString() === productId.toString()
  );
};

// Method to get wishlist with populated products
wishlistSchema.methods.getPopulatedWishlist = function() {
  return this.populate({
    path: 'products.product',
    populate: {
      path: 'store',
      select: 'name address owner'
    }
  });
};

// Static method to get or create wishlist for user
wishlistSchema.statics.getOrCreateWishlist = async function(userId) {
  let wishlist = await this.findOne({ user: userId });
  
  if (!wishlist) {
    wishlist = new this({
      user: userId,
      products: [],
      totalItems: 0
    });
    await wishlist.save();
  }
  
  return wishlist;
};

module.exports = mongoose.model("Wishlist", wishlistSchema);
