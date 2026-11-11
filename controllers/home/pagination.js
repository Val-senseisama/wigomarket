/**
 * Page/limit parsing shared by the home feeds. Each section on the home screen
 * asks for page 1 with its small default; the "view all" screen pages through
 * the same feed with a larger limit until `hasMore` is false.
 */
const parsePage = (query = {}, { defaultLimit, maxLimit }) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

module.exports = { parsePage };
