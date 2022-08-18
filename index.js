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
  'name',
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
// const ElasticIndex = `${ELASTIC_URL}/customers/_search`;

const app = express();

const requestBody = (q) => ({
  query: {
    query_string: {
      query: `*${q}*`,
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
      console.log(`400 - Body: ${JSON.stringify(body)}`);
      return;
    }

    if (!body.data) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: 'Data cannot be empty',
        body,
      });
      console.log(`400 - Body: ${JSON.stringify(body)}`);
      return;
    }

    if (!body.data.anrufer) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: 'Dataset for <anrufer> cannot be empty',
        body,
      });
      console.log(`400 - Body: ${JSON.stringify(body)}`);
      return;
    }

    let number = body.data.anrufer;
    number = number.replace(/(\+49)|[+-\s]/g, '');

    if (/[^\d]/gi.test(number)) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message:
          '<anrufer> must not contain non-digit characters except a leading +',
        body,
      });
      console.log(`400 - Body: ${JSON.stringify(body)}`);
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
          hits.name = hits.nachname;
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

app.post('/acrm-cust/live', (req, res) => {
  try {
    let body = req.body;

    if (body.function !== 'SucheKontakte') {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: "Can't resolve target function",
        body,
      });
      console.log(`400 - Body: ${JSON.stringify(body)}`);
      return;
    }

    if (!body.data) {
      res.status(400).json({
        status: 'BAD REQUEST',
        message: 'Data cannot be empty',
        body,
      });
      console.log(`400 - Body: ${JSON.stringify(body)}`);
      return;
    }

    let data = body.data;
    let should = [];

    if (!!data.kundennummer)
      should.push({ fuzzy: { kundennummer: { value: data.kundennummer } } });
    if (!!data.rufnummer1) {
      let fuzzys = [];
      let value = data.rufnummer1;
      for (let v of ['telefon', 'mobil', 'mp2', 'p2'])
        fuzzys.push({ [v]: { value } });
      for (let fuzzy of fuzzys) should.push({ fuzzy });
    }
    if (!!data.rufnummer2) {
      let fuzzys = [];
      let value = data.rufnummer2;
      for (let v of ['telefon', 'mobil', 'mp2', 'p2'])
        fuzzys.push({ [v]: { value } });
      for (let fuzzy of fuzzys) should.push({ fuzzy });
    }
    if (!!data.email)
      should.push({
        fuzzy: { 'email.keyword': { value: data.email } },
      });
    if (!!data.vorname)
      should.push({ fuzzy: { vorname: { value: data.vorname } } });
    if (!!data.nachname)
      should.push({ fuzzy: { nachname: { value: data.nachname } } });
    if (!!data.firma)
      should.push({ fuzzy: { nachname: { value: data.nachname } } });

    console.log(should);

    let request = {
      query: {
        bool: {
          should,
          minimum_should_match: 1,
        },
      },
    };

    axios
      .post(ElasticIndex, request)
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

        // let data = {};

        hits = hits.map((x) => {
          console.log(x);
          let data = {};
          x.name = x.nachname;
          for (let i of DATAFIELDS) {
            if (x[i]) data[i] = x[i];
          }
          data['x-id-kontakt'] = x.kundennummer;
          console.log(data);
          return data;
        });

        // if (hits.length > 0) {
        //   hits = hits[0]._source;
        //   for (let i of DATAFIELDS) {
        //     if (hits[i]) data[i] = hits[i];
        //   }
        // }

        // hits = data.map((x) => ({ 'x-id-kontakt': x.kundennummer, ...x }));

        data = { liste: hits };

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
