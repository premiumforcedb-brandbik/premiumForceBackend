const mongoose = require('mongoose');

const vatSchema = new mongoose.Schema({
    vat: {
        type: Number,
        required: true,
        min: 0,
        max: 100,
        default: 0
    }
}, {
    timestamps: true
});

// Static method to get the single VAT document
vatSchema.statics.getVat = async function() {
    let vat = await this.findOne();
    if (!vat) {
        vat = await this.create({ vat: 0 });
    }
    return vat;
};

// Static method to update VAT value
vatSchema.statics.updateVat = async function(newVatValue) {
    if (typeof newVatValue !== 'number' || newVatValue < 0 || newVatValue > 100) {
        throw new Error('VAT must be a number between 0 and 100');
    }
    
    let vat = await this.findOne();
    if (!vat) {
        vat = await this.create({ vat: newVatValue });
    } else {
        vat.vat = newVatValue;
        await vat.save();
    }
    return vat;
};

module.exports = mongoose.model('Vat', vatSchema);