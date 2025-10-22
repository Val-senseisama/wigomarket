 const welcome = () =>{
    return `<p>
Welcome to WigoMarket! We are thrilled to have you as part of our vibrant community of buyers and sellers. As a new user of our multi-vendor ecommerce app, you are now on your way to discovering a world of incredible products, exceptional deals, and seamless transactions.
 </p> 
 <p>At WigoMarket, we pride ourselves on being the ultimate destination for all your shopping needs. Whether you're searching for fashion-forward clothing, cutting-edge electronics, unique handcrafted items, or anything in between, our diverse marketplace is sure to have something that suits your taste.</p>
 <p>What makes WigoMarket stand out is our commitment to fostering a secure, user-friendly, and personalized shopping experience. With a wide range of trusted sellers offering their products, you can browse through an extensive catalog, read customer reviews, and make well-informed purchasing decisions.</p>

<p>Here's a glimpse of what awaits you on WigoMarket:</p>
<ul> 
<li>Vast Product Selection: Explore an extensive assortment of products from various categories, ensuring you'll find exactly what you're looking for.</li>

<li>Competitive Pricing: Discover amazing deals and enjoy competitive pricing from our sellers, helping you save money while shopping.</li>

<li>Secure Transactions: Rest assured that your transactions are protected by advanced security measures and encryption technology.</li>

<li>Customer Reviews: Make informed choices with the help of honest feedback and ratings provided by fellow shoppers.</li>
</ul>
 <br />
 Prince
 <br />
 WigoMarket Team

<footer style="text-align:center;">©2023 Wigomarket Team with ♥</footer>
</p>`}


// Verification Code Template
 const verificationCodeTemplate = (firstname, code) => {
    return `
        <div>
            <h1>Hello ${firstname},</h1>
            <p>Your verification code is <strong>${code}</strong>.</p>
            <p>This code is valid for 10 minutes.</p>
            <p>You can use this code to verify your account.</p>
            <p>Thank you for choosing WigoMarket!</p>
        </div>
    `;
};

// Forgot Password Code Template
 const forgotPasswordTemplate = (firstname, code) => {
    return `
        <div>
            <h1>Hello ${firstname},</h1>
            <p>Your password reset code is <strong>${code}</strong>.</p>
            <p>Please use this code to reset your password, it's valid for 10 minutes.</p>
            <p>If you did not request a password reset, please ignore this email.</p>
            <p>Thank you for using WigoMarket!</p>
        </div>
    `;
};


// Store Creation Success Template
 const storeCreationSuccessTemplate = (storeName, address) => {
    return `
        <div>
            <h1>Congratulations on Your New Store, ${storeName}!</h1>
            <p>We are excited to inform you that your store has been successfully created.</p>
            <p>Here are the details of your store:</p>
            <ul>
                <li><strong>Store Name:</strong> ${storeName}</li>
                <li><strong>Address:</strong> ${address}</li>
            </ul>
            <p>Thank you for choosing WigoMarket! We look forward to supporting you on your journey as a seller.</p>
        </div>
    `;
};


// Store Account Update Success Template
 const storeAccountUpdateSuccessTemplate = (bankName, accountNumber, accountName) => {
    return `
        <div>
            <h1>Your Store Account Details Have Been Updated!</h1>
            <p>We are pleased to inform you that your store account details have been successfully updated.</p>
            <p>Here are the updated details:</p>
            <ul>
                <li><strong>Bank Name:</strong> ${bankName}</li>
                <li><strong>Account Number:</strong> ${accountNumber}</li>
                <li><strong>Account Name:</strong> ${accountName}</li>
            </ul>
            <p>If you did not make this change, we strongly recommend that you change your password immediately to ensure the security of your account.</p>
            <p>Thank you for being a valued member of WigoMarket!</p>
        </div>
    `;
};

module.exports = { welcome, storeAccountUpdateSuccessTemplate, storeCreationSuccessTemplate, forgotPasswordTemplate, verificationCodeTemplate }