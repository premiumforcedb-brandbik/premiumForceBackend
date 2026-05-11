const twilio = require('twilio');

class TwilioVerifyService {
  constructor() {
    this.client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    this.serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  }

  /**
   * Send a verification code to a phone number
   * @param {string} phoneNumber 
   * @param {string} countryCode 
   * @param {string} channel - 'sms' or 'whatsapp'
   */
  async sendVerification(phoneNumber, countryCode, channel = 'sms') {
    try {
      const fullNumber = `${countryCode}${phoneNumber}`;
      const verification = await this.client.verify.v2
        .services(this.serviceSid)
        .verifications.create({
          to: fullNumber,
          channel: channel
        });

      return { success: true, sid: verification.sid, status: verification.status };
    } catch (error) {
      console.error('Twilio Verify Send Error:', error);
      throw new Error(error.message || 'Failed to send verification code');
    }
  }

  /**
   * Check a verification code
   * @param {string} phoneNumber 
   * @param {string} countryCode 
   * @param {string} code 
   */
  async checkVerification(phoneNumber, countryCode, code) {
    try {
      const fullNumber = `${countryCode}${phoneNumber}`;
      const verificationCheck = await this.client.verify.v2
        .services(this.serviceSid)
        .verificationChecks.create({
          to: fullNumber,
          code: code
        });

      return {
        success: verificationCheck.status === 'approved',
        status: verificationCheck.status
      };
    } catch (error) {
      console.error('Twilio Verify Check Error:', error);
      // Don't throw for invalid codes, just return success: false
      return { success: false, error: error.message };
    }
  }
}

module.exports = new TwilioVerifyService();
