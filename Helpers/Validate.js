 const Validate = {
    email: (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    URL: (url) => /^(ftp|http|https):\/\/[^ "]+$/.test(url),
    /**
     * Checks that a URL is a valid Cloudinary delivery URL from our account.
     * Cloudinary URLs look like:
     *   https://res.cloudinary.com/{cloud_name}/image/upload/v{version}/{path}
     * Rejects any string that is not a proper https://res.cloudinary.com/... URL.
     */
    cloudinaryUrl: (url) => {
      if (typeof url !== 'string' || !url.trim()) return false;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return false;
        if (parsed.hostname !== 'res.cloudinary.com') return false;
        // If the cloud name env var is set, enforce it so foreign Cloudinary
        // accounts cannot be injected.
        const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
        if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/`)) {
          return false;
        }
        return true;
      } catch {
        return false;
      }
    },
    phone: (phone) => /^[0-9]+$/.test(phone),
    integer: (value) => Number.isInteger(value),
    positiveInteger: (value) => Number.isInteger(value) && value >= 0,
    float: (value) => Number.isFinite(value),
    string: (value) => typeof value === 'string' && value.trim() !== '',
    array: (value) => Array.isArray(value) && value.length > 0,
    object: (value) => typeof value === 'object' && value !== null && Object.keys(value).length > 0,
    ISODate: (dateString) => !isNaN(Date.parse(dateString)) && new Date(dateString).toISOString() === dateString,
    date: (dateString) => /^\d{4}-\d{2}-\d{2}$/.test(dateString) && !isNaN(new Date(dateString).getTime()),
    time: (time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time),
    datetime: (dateString) => !isNaN(Date.parse(dateString)) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateString),
    formatPhone: (phone) => {
        let inputString = phone.split(' ').join('')
            .split('+').join('')
            .split('-').join('')
            .split('(').join('')
            .split(')').join('');
        if (inputString.startsWith('009')) {
            return inputString.slice(3);
        } else if (inputString.startsWith('0')) {
            return '234' + inputString.slice(1);
        } else {
            return inputString;
        }
    },
 };

 // Support both styles:
 //   const Validate = require('./Validate')          → the object
 //   const { Validate } = require('./Validate')      → the same object
 module.exports = Validate;
 module.exports.Validate = Validate;