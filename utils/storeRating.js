/**
 * A shop's public rating, derived from its products' ratings (there is no
 * separate seller rating).
 *
 *   count   — number of product reviews across the shop's unhidden products
 *   average — those reviews' average star rating, to one decimal
 *
 * Out-of-stock products still count: a shop's reviews don't disappear when an
 * item sells out. Hidden products don't — the public can't see them.
 *
 * Every public place that shows a shop's rating (home cards, store page) uses
 * this so the numbers agree.
 */
const mongoose = require("mongoose");

/** Product $match for a store's rating (and the base for its public products). */
const RATED_PRODUCT_MATCH = { status: { $ne: "hidden" } };

/**
 * $addFields entries computing `rating` from an array of products that carry
 * `rating.average` and `rating.count`.
 * @param {string} products - aggregation path of the array, e.g. "$products"
 */
const ratingFields = (products = "$products") => {
  const count = { $sum: `${products}.rating.count` };
  return {
    "rating.count": count,
    "rating.average": {
      $cond: {
        if: { $gt: [count, 0] },
        then: {
          $divide: [
            {
              $sum: {
                $map: {
                  input: products,
                  as: "p",
                  in: { $multiply: ["$$p.rating.average", "$$p.rating.count"] },
                },
              },
            },
            count,
          ],
        },
        else: 0,
      },
    },
  };
};

/**
 * The rating for one store.
 * @returns {Promise<{average: number, count: number}>}
 */
const getStoreRating = async (storeId) => {
  const Product = mongoose.model("Product");
  const [row] = await Product.aggregate([
    {
      $match: {
        store: new mongoose.Types.ObjectId(String(storeId)),
        ...RATED_PRODUCT_MATCH,
        "rating.count": { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: "$rating.count" },
        weighted: { $sum: { $multiply: ["$rating.average", "$rating.count"] } },
      },
    },
  ]);
  if (!row || !row.count) return { average: 0, count: 0 };
  return { average: Math.round((row.weighted / row.count) * 10) / 10, count: row.count };
};

module.exports = { RATED_PRODUCT_MATCH, ratingFields, getStoreRating };
