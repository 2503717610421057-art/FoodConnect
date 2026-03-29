const mongoose = require("mongoose");

const listingSchema = new mongoose.Schema({
  donorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 100 },
  quantity: { type: Number, required: true, min: 1 },
  fulfilledQuantity: { type: Number, default: 0 }, // For the "Bulk Flow" (Partial fulfillments)
  foodType: { type: String, enum: ["veg", "non-veg", "vegan"], required: true },
  safetyChecklistAgreed: { type: Boolean, required: true }, // SAFETY LAYER
  expiryTime: { 
    type: Date, required: true,
    validate: {
      validator: function(value) { return value > Date.now(); },
      message: "Expiry time must be in the future"
    }
  },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },
  status: {
    type: String,
    enum: ["active", "accepted", "completed", "expired"], // Note: 'active' is the default
    default: "active",
    index: true
  }
}, { timestamps: true });

listingSchema.index({ location: '2dsphere', status: 1 });

module.exports = mongoose.model("Listing", listingSchema);