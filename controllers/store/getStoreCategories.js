const mongoose = require("mongoose");
const asyncHandler = require("express-async-handler");
const Store = require("../../models/storeModel");
const Product = require("../../models/productModel");
const validateMongodbId = require("../../utils/validateMongodbId");
const { isStorePublic } = require("../../utils/storeVisibility");

/**
 * @function getStoreCategories
 * @description The category filter on a shop's products screen: the categories
 *   this shop has products in, with how many. Counts the same products the
 *   storefront lists by default (unhidden and in stock), so picking an entry
 *   and calling GET /api/product/get-products?store={id}&category={categoryId}
 *   never returns an empty page.
 * @route GET /api/store/:id/categories
 */
const getStoreCategories = asyncHandler(async (req, res) => {
  const { id } = req.params;
  validateMongodbId(id);

  const store = await Store.findById(id, "isVisible status").lean();
  if (!isStorePublic(store)) {
    return res.status(404).json({ success: false, message: "Store not found" });
  }

  const rows = await Product.aggregate([
    {
      $match: {
        store: new mongoose.Types.ObjectId(id),
        status: "active",
        quantity: { $gt: 0 },
      },
    },
    { $group: { _id: "$category", productCount: { $sum: 1 } } },
    {
      $lookup: {
        from: "categories",
        localField: "_id",
        foreignField: "_id",
        as: "category",
        pipeline: [{ $project: { name: 1, image: 1 } }],
      },
    },
    { $unwind: "$category" },
    { $sort: { "category.name": 1 } },
  ]);

  res.json({
    success: true,
    data: rows.map((r) => ({
      id: r._id,
      name: r.category.name,
      image: r.category.image || null,
      productCount: r.productCount,
    })),
  });
});

module.exports = getStoreCategories;
