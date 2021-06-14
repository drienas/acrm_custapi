if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const SECRET = process.env.JWT_SECRET || null;
if (!SECRET) {
  console.log(`No JWT secret found`);
  process.exit(0);
}

const jwt = require('jsonwebtoken');

const createToken = (handle) =>
  jwt.sign(
    {
      handle,
    },
    SECRET
  );

const verifyToken = (token) => {
  let valid = false;
  let data = null;
  try {
    data = jwt.verify(token, SECRET);
    valid = true;
  } catch (err) {
    data = null;
    valid = false;
  } finally {
    return {
      valid,
      data,
    };
  }
};

module.exports = { createToken, verifyToken };
