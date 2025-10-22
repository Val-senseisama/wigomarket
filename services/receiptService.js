const puppeteer = require('puppeteer');
const handlebars = require('handlebars');
const fs = require('fs');
const path = require('path');
const { MakeID } = require('../Helpers/Helpers');

/**
 * Receipt Generation Service
 * Handles PDF generation for receipts, invoices, and financial reports
 */
class ReceiptService {
  constructor() {
    this.templatesDir = path.join(__dirname, '../templates');
    this.outputDir = path.join(__dirname, '../public/receipts');
    this.ensureOutputDir();
  }

  /**
   * Ensure output directory exists
   */
  ensureOutputDir() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate payment receipt PDF
   * @param {Object} order - Order object with populated data
   * @param {Object} transaction - Transaction object
   * @param {Object} commissionData - Commission breakdown
   * @param {Object} vatData - VAT information
   * @returns {Promise<string>} - Path to generated PDF
   */
  async generatePaymentReceipt(order, transaction, commissionData, vatData) {
    try {
      const receiptData = {
        receiptNumber: transaction.transactionId,
        orderNumber: order.paymentIntent.id,
        date: new Date().toLocaleDateString('en-NG'),
        time: new Date().toLocaleTimeString('en-NG'),
        
        // Customer information
        customer: {
          name: order.orderedBy.fullName || 'Customer',
          email: order.orderedBy.email,
          phone: order.orderedBy.mobile || 'N/A',
          address: order.deliveryAddress || 'N/A'
        },
        
        // Order items
        items: order.products.map(item => ({
          name: item.product.title,
          store: item.store.name,
          quantity: item.count,
          unitPrice: item.product.listedPrice,
          totalPrice: item.product.listedPrice * item.count
        })),
        
        // Financial breakdown
        subtotal: order.paymentIntent.amount - vatData.amount - (order.deliveryFee || 0),
        deliveryFee: order.deliveryFee || 0,
        vat: {
          rate: vatData.rate,
          amount: vatData.amount,
          responsibility: vatData.responsibility
        },
        total: order.paymentIntent.amount,
        
        // Payment information
        payment: {
          method: order.paymentMethod,
          status: order.paymentStatus,
          transactionId: transaction.transactionId,
          paidAt: order.paymentIntent.paid_at || new Date()
        },
        
        // Commission breakdown
        commission: {
          platformRate: commissionData.platformRate,
          platformAmount: commissionData.platformAmount,
          vendorAmount: commissionData.vendorAmount,
          dispatchAmount: commissionData.dispatchAmount
        },
        
        // Company information
        company: {
          name: 'WigoMarket',
          address: 'Lagos, Nigeria',
          phone: '+234 XXX XXX XXXX',
          email: 'support@wigomarket.com',
          website: 'www.wigomarket.com'
        }
      };

      const html = await this.renderReceiptTemplate(receiptData);
      const pdfPath = await this.generatePDF(html, `receipt_${transaction.transactionId}.pdf`);
      
      return pdfPath;
    } catch (error) {
      throw new Error(`Failed to generate payment receipt: ${error.message}`);
    }
  }

  /**
   * Generate transaction statement PDF
   * @param {Object} user - User object
   * @param {Array} transactions - Array of transaction objects
   * @param {Object} filters - Date range and other filters
   * @returns {Promise<string>} - Path to generated PDF
   */
  async generateTransactionStatement(user, transactions, filters = {}) {
    try {
      const statementData = {
        statementNumber: `STMT_${Date.now()}_${MakeID(6)}`,
        period: {
          from: filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-NG'),
          to: filters.endDate || new Date().toLocaleDateString('en-NG')
        },
        generatedAt: new Date().toLocaleString('en-NG'),
        
        // User information
        user: {
          name: user.fullName || 'User',
          email: user.email,
          phone: user.mobile || 'N/A',
          roles: user.role.join(', ')
        },
        
        // Transaction summary
        summary: {
          totalTransactions: transactions.length,
          totalAmount: transactions.reduce((sum, txn) => sum + txn.totalAmount, 0),
          totalDebits: transactions.reduce((sum, txn) => 
            sum + txn.entries.reduce((entrySum, entry) => entrySum + entry.debit, 0), 0),
          totalCredits: transactions.reduce((sum, txn) => 
            sum + txn.entries.reduce((entrySum, entry) => entrySum + entry.credit, 0), 0)
        },
        
        // Transactions
        transactions: transactions.map(txn => ({
          id: txn.transactionId,
          reference: txn.reference,
          type: txn.type,
          date: txn.createdAt.toLocaleDateString('en-NG'),
          amount: txn.totalAmount,
          status: txn.status,
          description: txn.entries[0]?.description || 'Transaction'
        })),
        
        // Company information
        company: {
          name: 'WigoMarket',
          address: 'Lagos, Nigeria',
          phone: '+234 XXX XXX XXXX',
          email: 'support@wigomarket.com',
          website: 'www.wigomarket.com'
        }
      };

      const html = await this.renderStatementTemplate(statementData);
      const pdfPath = await this.generatePDF(html, `statement_${statementData.statementNumber}.pdf`);
      
      return pdfPath;
    } catch (error) {
      throw new Error(`Failed to generate transaction statement: ${error.message}`);
    }
  }

  /**
   * Generate withdrawal receipt PDF
   * @param {Object} receiptData - Withdrawal receipt data
   * @returns {Promise<string>} - Path to generated PDF
   */
  async generateWithdrawalReceipt(receiptData) {
    try {
      const html = await this.renderWithdrawalReceiptTemplate(receiptData);
      const pdfPath = await this.generatePDF(html, `withdrawal_receipt_${receiptData.receiptNumber}.pdf`);
      
      return pdfPath;
    } catch (error) {
      throw new Error(`Failed to generate withdrawal receipt: ${error.message}`);
    }
  }

  /**
   * Generate VAT report PDF (Admin only)
   * @param {Object} vatSummary - VAT summary data
   * @param {Object} filters - Date range and filters
   * @returns {Promise<string>} - Path to generated PDF
   */
  async generateVATReport(vatSummary, filters = {}) {
    try {
      const reportData = {
        reportNumber: `VAT_${Date.now()}_${MakeID(6)}`,
        period: {
          from: filters.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-NG'),
          to: filters.endDate || new Date().toLocaleDateString('en-NG')
        },
        generatedAt: new Date().toLocaleString('en-NG'),
        
        // VAT summary
        summary: vatSummary,
        
        // Company information
        company: {
          name: 'WigoMarket',
          address: 'Lagos, Nigeria',
          phone: '+234 XXX XXX XXXX',
          email: 'support@wigomarket.com',
          website: 'www.wigomarket.com'
        }
      };

      const html = await this.renderVATReportTemplate(reportData);
      const pdfPath = await this.generatePDF(html, `vat_report_${reportData.reportNumber}.pdf`);
      
      return pdfPath;
    } catch (error) {
      throw new Error(`Failed to generate VAT report: ${error.message}`);
    }
  }

  /**
   * Render receipt template with data
   * @param {Object} data - Receipt data
   * @returns {Promise<string>} - Rendered HTML
   */
  async renderReceiptTemplate(data) {
    const templatePath = path.join(this.templatesDir, 'receipt.hbs');
    
    if (!fs.existsSync(templatePath)) {
      // Create default receipt template if it doesn't exist
      await this.createDefaultReceiptTemplate();
    }
    
    const template = fs.readFileSync(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Render statement template with data
   * @param {Object} data - Statement data
   * @returns {Promise<string>} - Rendered HTML
   */
  async renderStatementTemplate(data) {
    const templatePath = path.join(this.templatesDir, 'statement.hbs');
    
    if (!fs.existsSync(templatePath)) {
      // Create default statement template if it doesn't exist
      await this.createDefaultStatementTemplate();
    }
    
    const template = fs.readFileSync(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Render withdrawal receipt template with data
   * @param {Object} data - Withdrawal receipt data
   * @returns {Promise<string>} - Rendered HTML
   */
  async renderWithdrawalReceiptTemplate(data) {
    const templatePath = path.join(this.templatesDir, 'withdrawal-receipt.hbs');
    
    if (!fs.existsSync(templatePath)) {
      // Create default withdrawal receipt template if it doesn't exist
      await this.createDefaultWithdrawalReceiptTemplate();
    }
    
    const template = fs.readFileSync(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Render VAT report template with data
   * @param {Object} data - VAT report data
   * @returns {Promise<string>} - Rendered HTML
   */
  async renderVATReportTemplate(data) {
    const templatePath = path.join(this.templatesDir, 'vat-report.hbs');
    
    if (!fs.existsSync(templatePath)) {
      // Create default VAT report template if it doesn't exist
      await this.createDefaultVATReportTemplate();
    }
    
    const template = fs.readFileSync(templatePath, 'utf8');
    const compiledTemplate = handlebars.compile(template);
    return compiledTemplate(data);
  }

  /**
   * Generate PDF from HTML
   * @param {string} html - HTML content
   * @param {string} filename - Output filename
   * @returns {Promise<string>} - Path to generated PDF
   */
  async generatePDF(html, filename) {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      
      const pdfPath = path.join(this.outputDir, filename);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '20mm',
          bottom: '20mm',
          left: '20mm'
        }
      });
      
      return pdfPath;
    } finally {
      await browser.close();
    }
  }

  /**
   * Create default receipt template
   */
  async createDefaultReceiptTemplate() {
    const templatePath = path.join(this.templatesDir, 'receipt.hbs');
    
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }
    
    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Payment Receipt</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .company-name { font-size: 24px; font-weight: bold; color: #333; }
        .receipt-title { font-size: 18px; margin: 10px 0; }
        .receipt-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .customer-info, .payment-info { width: 48%; }
        .section-title { font-weight: bold; margin-bottom: 10px; color: #555; }
        .items-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .items-table th, .items-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .items-table th { background-color: #f2f2f2; }
        .totals { margin-top: 20px; text-align: right; }
        .total-line { margin: 5px 0; }
        .grand-total { font-weight: bold; font-size: 16px; border-top: 2px solid #333; padding-top: 10px; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">{{company.name}}</div>
        <div class="receipt-title">PAYMENT RECEIPT</div>
    </div>
    
    <div class="receipt-info">
        <div class="customer-info">
            <div class="section-title">Customer Information</div>
            <div><strong>Name:</strong> {{customer.name}}</div>
            <div><strong>Email:</strong> {{customer.email}}</div>
            <div><strong>Phone:</strong> {{customer.phone}}</div>
            <div><strong>Address:</strong> {{customer.address}}</div>
        </div>
        <div class="payment-info">
            <div class="section-title">Receipt Details</div>
            <div><strong>Receipt #:</strong> {{receiptNumber}}</div>
            <div><strong>Order #:</strong> {{orderNumber}}</div>
            <div><strong>Date:</strong> {{date}}</div>
            <div><strong>Time:</strong> {{time}}</div>
        </div>
    </div>
    
    <table class="items-table">
        <thead>
            <tr>
                <th>Item</th>
                <th>Store</th>
                <th>Qty</th>
                <th>Unit Price</th>
                <th>Total</th>
            </tr>
        </thead>
        <tbody>
            {{#each items}}
            <tr>
                <td>{{name}}</td>
                <td>{{store}}</td>
                <td>{{quantity}}</td>
                <td>₦{{unitPrice}}</td>
                <td>₦{{totalPrice}}</td>
            </tr>
            {{/each}}
        </tbody>
    </table>
    
    <div class="totals">
        <div class="total-line">Subtotal: ₦{{subtotal}}</div>
        {{#if deliveryFee}}
        <div class="total-line">Delivery Fee: ₦{{deliveryFee}}</div>
        {{/if}}
        <div class="total-line">VAT ({{vat.rate}}%): ₦{{vat.amount}}</div>
        <div class="total-line grand-total">Total: ₦{{total}}</div>
    </div>
    
    <div class="footer">
        <p>Thank you for your business!</p>
        <p>{{company.name}} | {{company.address}} | {{company.phone}} | {{company.email}}</p>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(templatePath, template);
  }

  /**
   * Create default statement template
   */
  async createDefaultStatementTemplate() {
    const templatePath = path.join(this.templatesDir, 'statement.hbs');
    
    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Transaction Statement</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .company-name { font-size: 24px; font-weight: bold; color: #333; }
        .statement-title { font-size: 18px; margin: 10px 0; }
        .statement-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .user-info, .statement-details { width: 48%; }
        .section-title { font-weight: bold; margin-bottom: 10px; color: #555; }
        .summary { background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .transactions-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .transactions-table th, .transactions-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .transactions-table th { background-color: #f2f2f2; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">{{company.name}}</div>
        <div class="statement-title">TRANSACTION STATEMENT</div>
    </div>
    
    <div class="statement-info">
        <div class="user-info">
            <div class="section-title">Account Information</div>
            <div><strong>Name:</strong> {{user.name}}</div>
            <div><strong>Email:</strong> {{user.email}}</div>
            <div><strong>Phone:</strong> {{user.phone}}</div>
            <div><strong>Roles:</strong> {{user.roles}}</div>
        </div>
        <div class="statement-details">
            <div class="section-title">Statement Details</div>
            <div><strong>Statement #:</strong> {{statementNumber}}</div>
            <div><strong>Period:</strong> {{period.from}} - {{period.to}}</div>
            <div><strong>Generated:</strong> {{generatedAt}}</div>
        </div>
    </div>
    
    <div class="summary">
        <div class="section-title">Summary</div>
        <div><strong>Total Transactions:</strong> {{summary.totalTransactions}}</div>
        <div><strong>Total Amount:</strong> ₦{{summary.totalAmount}}</div>
        <div><strong>Total Debits:</strong> ₦{{summary.totalDebits}}</div>
        <div><strong>Total Credits:</strong> ₦{{summary.totalCredits}}</div>
    </div>
    
    <table class="transactions-table">
        <thead>
            <tr>
                <th>Transaction ID</th>
                <th>Reference</th>
                <th>Type</th>
                <th>Date</th>
                <th>Amount</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            {{#each transactions}}
            <tr>
                <td>{{id}}</td>
                <td>{{reference}}</td>
                <td>{{type}}</td>
                <td>{{date}}</td>
                <td>₦{{amount}}</td>
                <td>{{status}}</td>
            </tr>
            {{/each}}
        </tbody>
    </table>
    
    <div class="footer">
        <p>This is a computer-generated statement.</p>
        <p>{{company.name}} | {{company.address}} | {{company.phone}} | {{company.email}}</p>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(templatePath, template);
  }

  /**
   * Create default withdrawal receipt template
   */
  async createDefaultWithdrawalReceiptTemplate() {
    const templatePath = path.join(this.templatesDir, 'withdrawal-receipt.hbs');
    
    if (!fs.existsSync(this.templatesDir)) {
      fs.mkdirSync(this.templatesDir, { recursive: true });
    }
    
    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Withdrawal Receipt</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .company-name { font-size: 24px; font-weight: bold; color: #333; }
        .receipt-title { font-size: 18px; margin: 10px 0; }
        .receipt-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .user-info, .withdrawal-info { width: 48%; }
        .section-title { font-weight: bold; margin-bottom: 10px; color: #555; }
        .withdrawal-details { background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .detail-row { display: flex; justify-content: space-between; margin: 8px 0; }
        .detail-label { font-weight: bold; }
        .detail-value { color: #333; }
        .totals { margin-top: 20px; text-align: right; }
        .total-line { margin: 5px 0; }
        .grand-total { font-weight: bold; font-size: 16px; border-top: 2px solid #333; padding-top: 10px; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">{{company.name}}</div>
        <div class="receipt-title">WITHDRAWAL RECEIPT</div>
    </div>
    
    <div class="receipt-info">
        <div class="user-info">
            <div class="section-title">Account Information</div>
            <div><strong>Name:</strong> {{user.name}}</div>
            <div><strong>Email:</strong> {{user.email}}</div>
            <div><strong>Phone:</strong> {{user.phone}}</div>
        </div>
        <div class="withdrawal-info">
            <div class="section-title">Receipt Details</div>
            <div><strong>Receipt #:</strong> {{receiptNumber}}</div>
            <div><strong>Date:</strong> {{date}}</div>
            <div><strong>Time:</strong> {{time}}</div>
        </div>
    </div>
    
    <div class="withdrawal-details">
        <div class="section-title">Withdrawal Details</div>
        <div class="detail-row">
            <span class="detail-label">Withdrawal Amount:</span>
            <span class="detail-value">₦{{withdrawal.amount}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Processing Fee:</span>
            <span class="detail-value">₦{{withdrawal.fee}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Total Deducted:</span>
            <span class="detail-value">₦{{withdrawal.totalDeduction}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">{{withdrawal.status}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Processed At:</span>
            <span class="detail-value">{{withdrawal.processedAt}}</span>
        </div>
    </div>
    
    <div class="withdrawal-details">
        <div class="section-title">Bank Account Details</div>
        <div class="detail-row">
            <span class="detail-label">Account Name:</span>
            <span class="detail-value">{{withdrawal.bankAccount.accountName}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Account Number:</span>
            <span class="detail-value">{{withdrawal.bankAccount.accountNumber}}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Bank:</span>
            <span class="detail-value">{{withdrawal.bankAccount.bankName}}</span>
        </div>
    </div>
    
    <div class="footer">
        <p>Thank you for using WigoMarket!</p>
        <p>{{company.name}} | {{company.address}} | {{company.phone}} | {{company.email}}</p>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(templatePath, template);
  }

  /**
   * Create default VAT report template
   */
  async createDefaultVATReportTemplate() {
    const templatePath = path.join(this.templatesDir, 'vat-report.hbs');
    
    const template = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>VAT Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .company-name { font-size: 24px; font-weight: bold; color: #333; }
        .report-title { font-size: 18px; margin: 10px 0; }
        .report-info { display: flex; justify-content: space-between; margin-bottom: 20px; }
        .report-details { width: 100%; }
        .section-title { font-weight: bold; margin-bottom: 10px; color: #555; }
        .summary { background-color: #f9f9f9; padding: 15px; margin: 20px 0; border-radius: 5px; }
        .footer { margin-top: 40px; text-align: center; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-name">{{company.name}}</div>
        <div class="report-title">VAT REPORT</div>
    </div>
    
    <div class="report-info">
        <div class="report-details">
            <div class="section-title">Report Details</div>
            <div><strong>Report #:</strong> {{reportNumber}}</div>
            <div><strong>Period:</strong> {{period.from}} - {{period.to}}</div>
            <div><strong>Generated:</strong> {{generatedAt}}</div>
        </div>
    </div>
    
    <div class="summary">
        <div class="section-title">VAT Summary</div>
        <div><strong>Total VAT Collected:</strong> ₦{{summary.totalVATCollected}}</div>
        <div><strong>Total Transactions:</strong> {{summary.totalTransactions}}</div>
        <div><strong>Platform Responsibility:</strong> ₦{{summary.platformVAT}}</div>
        <div><strong>Vendor Responsibility:</strong> ₦{{summary.vendorVAT}}</div>
    </div>
    
    <div class="footer">
        <p>This is a computer-generated VAT report.</p>
        <p>{{company.name}} | {{company.address}} | {{company.phone}} | {{company.email}}</p>
    </div>
</body>
</html>`;
    
    fs.writeFileSync(templatePath, template);
  }
}

module.exports = new ReceiptService();
