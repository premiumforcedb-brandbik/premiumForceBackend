require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// Fix paths since we are in scratch/
const baseDir = path.join(__dirname, '..');

const User = require(path.join(baseDir, 'models/users_model'));
const Car = require(path.join(baseDir, 'models/car_model'));
const City = require(path.join(baseDir, 'models/city_model'));
const Airport = require(path.join(baseDir, 'models/airportsModel'));
const Terminal = require(path.join(baseDir, 'models/terminal_model'));
const Category = require(path.join(baseDir, 'models/categoryModel'));
const Brand = require(path.join(baseDir, 'models/brandModel'));
const { generateUserTokens } = require(path.join(baseDir, 'utils/userAuthUtils'));

async function getData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        
        const user = await User.findOne({ role: 'customer' });
        const car = await Car.findOne({}).populate('categoryID').populate('brandID');
        const city = await City.findOne({ isActive: true });
        const airport = await Airport.findOne({ cityID: city?._id });
        const terminal = await Terminal.findOne({ airportID: airport?._id });

        const data = {
            user: user ? { _id: user._id, email: user.email, username: user.username } : null,
            car: car ? { 
                _id: car._id, 
                carName: car.carName, 
                categoryID: car.categoryID?._id,
                brandID: car.brandID?._id,
                model: car.model
            } : null,
            city: city ? { _id: city._id, cityName: city.cityName } : null,
            airport: airport ? { _id: airport._id, airportName: airport.airportName } : null,
            terminal: terminal ? { _id: terminal._id, terminalName: terminal.terminalName } : null
        };

        if (user) {
            const tokens = generateUserTokens(user);
            data.tokens = tokens;
        }

        console.log('---DATA_START---');
        console.log(JSON.stringify(data, null, 2));
        console.log('---DATA_END---');

        await mongoose.disconnect();
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

getData();
