if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const axios = require('axios');
const cors = require('cors');

const DATAFIELDS = [
  'kundennummer',
  'anrede',
  'vorname',
  'nachname',
  'strasse',
  'plz',
  'ort',
  'land',
  'email',
  'telefon',
  'mobil',
  'fax',
];

const { verifyToken } = require('./jwt');

const PORT = 3333;
const ELASTIC_URL = process.env.ELASTIC_URL || null;
if (!ELASTIC_URL) {
  console.log(`No Elastic-URL found`);
  process.exit(0);
}

const ElasticIndex = `${ELASTIC_URL}/acrm_custsync/_search`;

const app = express();

const requestBody = (q) => ({
  query: {
    query_string: {
      query: `*${q}`,
      fields: ['telefon', 'mobil', 'mp2', 'p2'],
    },
  },
});

app.use(morgan('[:date] :method :url :status - :response-time ms'));
app.use(cors());
app.use(bodyParser.json());

app.use((req, res, next) => {
  if (!req.headers.authorization) {
    res.status(401).send({
      status: 'UNAUTHORIZED',
      message: 'No token found',
    });
    return;
  }

  const token = req.headers.authorization.split(' ')[1];
  const { valid, data } = verifyToken(token);

  if (!valid) {
    res.status(401).send({
      status: 'UNAUTHORIZED',
      message: 'Invalid token set',
    });
    return;
  }
  next();
});

app.post('/acrm-cust/callCustomerSearch', (req, res) => {
  try {
    let body = req.body;

    if (body.function !== 'callCustomerSearch') {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: "Can't resolve target function",
        body,
      });
      return;
    }

    if (!body.data) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: 'Data cannot be empty',
        body,
      });
      return;
    }

    if (!body.data.anrufer) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: 'Dataset for <anrufer> cannot be empty',
        body,
      });
      return;
    }

    let number = body.data.anrufer;
    number = number.replace('+49', '').replace('+', '');

    if (/[^\d]/gi.test(number)) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message:
          '<anrufer> must not contain non-digit characters except a leading +',
      });
      return;
    }

    axios
      .post(ElasticIndex, requestBody(number))
      .then((response) => {
        if (response.status !== 200) {
          res.status(500).json({
            status: 'INTERNAL SERVER ERROR',
            message: `Database server responded with status code ${response.status}`,
            body,
          });
          return;
        }

        let dt = response.data;
        let hits = dt.hits.hits;
        if (!Array.isArray(hits)) throw `Hits is not an array`;

        let data = {};

        if (hits.length > 0) {
          hits = hits[0]._source;
          for (let i of DATAFIELDS) {
            if (hits[i]) data[i] = hits[i];
          }
        }

        res.status(200).json({
          status: 'OK',
          data,
        });
      })
      .catch((err) => {
        console.error(new Error(err));
        res.status(500).json({
          status: 'INTERNAL SERVER ERROR',
          message: 'An unexpected error occured',
          body,
        });
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: 'INTERNAL SERVER ERROR',
      message: 'An unexpected error occured',
      body,
    });
  }
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
