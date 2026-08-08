const mongoose = require('mongoose'); // Erase if already required
const { SPEC_SCHEMA_KEYS } = require('../utils/productSpecs');

/**
 * Categories form a two-level tree: top-level categories (Fashion, Phones &
 * Accessories, …) with `parent: null`, and subcategories that point at one.
 * The add-product category picker renders this tree — see
 * GET /api/product/categories?tree=true.
 *
 * `specSchema` decides whether the "Product Specification" step (3/3) appears
 * for a product in this category, and which field set it shows. It is inherited:
 * a subcategory with no schema of its own uses its parent's, so tagging
 * "Phones & Accessories" once covers every subcategory beneath it. Resolve it
 * with resolveSpecSchema() rather than reading the field directly.
 */
var categorySchema = new mongoose.Schema({
    name:{
        type:String,
        required:true,
        // Names stay globally unique rather than unique-per-parent. Making them
        // unique per parent would mean dropping this index on a live database,
        // which Mongoose will not do on its own — not worth it until a genuine
        // duplicate subcategory name is needed.
        unique:true,
        index:true,
    },
    image:{
        type:String,          // Cloudinary URL — upload via POST /api/upload/signature (folder: categories)
        default: null,
    },
    // null for a top-level category.
    parent:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        default: null,
        index: true,
    },
    // Which specification form products in this category must fill in.
    // null means the product flow skips the specification step entirely.
    specSchema:{
        type: String,
        enum: [...SPEC_SCHEMA_KEYS, null],
        default: null,
    },
});

/**
 * The spec schema that applies to a category, following the parent link when
 * the category does not declare one itself.
 *
 * @param {Object} category - Category doc. `parent` may be an id or populated.
 * @returns {Promise<string|null>} "phone" | "computer" | null
 */
categorySchema.statics.resolveSpecSchema = async function (category) {
    if (!category) return null;
    if (category.specSchema) return category.specSchema;
    if (!category.parent) return null;

    // Populated parent — no second round trip needed.
    if (typeof category.parent === 'object' && category.parent.specSchema !== undefined) {
        return category.parent.specSchema || null;
    }

    const parent = await this.findById(category.parent).select('specSchema').lean();
    return parent?.specSchema || null;
};

//Export the model
module.exports = mongoose.model('Category', categorySchema);
