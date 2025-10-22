const mongoose = require("mongoose");

// Rating and review schema for delivery agents
const ratingSchema = new mongoose.Schema({
  order: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Order",
    required: true,
    index: true
  },
  deliveryAgent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    index: true
  },
  review: {
    type: String,
    maxlength: 500
  },
  breakdown: {
    punctuality: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    communication: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    handling: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    },
    professionalism: {
      type: Number,
      min: 1,
      max: 5,
      required: true
    }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  helpful: {
    type: Number,
    default: 0
  },
  notHelpful: {
    type: Number,
    default: 0
  },
  response: {
    text: String,
    respondedAt: Date,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  status: {
    type: String,
    enum: ["active", "hidden", "reported"],
    default: "active",
    index: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
ratingSchema.index({ deliveryAgent: 1, createdAt: -1 });
ratingSchema.index({ customer: 1, createdAt: -1 });
ratingSchema.index({ order: 1 }, { unique: true }); // One rating per order
ratingSchema.index({ rating: 1 });
ratingSchema.index({ status: 1 });

// Pre-save middleware to update delivery agent's rating
ratingSchema.post('save', async function() {
  try {
    const deliveryAgentId = this.deliveryAgent;
    
    // Calculate average rating for this delivery agent
    const stats = await mongoose.model('Rating').aggregate([
      { $match: { deliveryAgent: deliveryAgentId, status: 'active' } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
          punctuality: { $avg: '$breakdown.punctuality' },
          communication: { $avg: '$breakdown.communication' },
          handling: { $avg: '$breakdown.handling' },
          professionalism: { $avg: '$breakdown.professionalism' }
        }
      }
    ]);

    if (stats.length > 0) {
      const stat = stats[0];
      
      // Update dispatch profile with new ratings
      await mongoose.model('DispatchProfile').findOneAndUpdate(
        { user: deliveryAgentId },
        {
          'rating.average': Math.round(stat.averageRating * 10) / 10,
          'rating.totalReviews': stat.totalReviews,
          'rating.breakdown': {
            punctuality: Math.round(stat.punctuality * 10) / 10,
            communication: Math.round(stat.communication * 10) / 10,
            handling: Math.round(stat.handling * 10) / 10,
            professionalism: Math.round(stat.professionalism * 10) / 10
          }
        }
      );
    }
  } catch (error) {
    console.log('Error updating delivery agent rating:', error.message);
  }
});

module.exports = mongoose.model("Rating", ratingSchema);
