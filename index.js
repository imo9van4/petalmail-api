// Express is the Node framework that we're using to make our endpoints and middleware
const express = require('express');

// bodyParser parses the JSON from incoming post and put requests
const bodyParser = require('body-parser');

// jsonwebtoken is what we use to encode and decode objects to use as authentication tokens
const jwt = require('jsonwebtoken');
// bcryt is what we use to encode and decode passwords
const bcrypt = require('bcrypt');

// cors is something else that wee need to run in our middleware
const cors = require('cors');

// The package that we use to connect to a mySQL database
const mysql = require('mysql2/promise');

// Creates an instance of Express that we use to make our API
const app = express();

// We import and immediately load the `.env` file. We need to run this before we can use `process.env`
require('dotenv').config();

const port = process.env.PORT;

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

// The `use` functions are the middleware - they get called before an endpoint is hit
app.use(async function mysqlConnection(req, res, next) {
  try {
    req.db = await pool.getConnection();
    req.db.connection.config.namedPlaceholders = true;

    // Traditional mode ensures not null is respected for unsupplied fields, ensures valid JavaScript dates, etc.
    await req.db.query('SET SESSION sql_mode = "TRADITIONAL"');
    await req.db.query(`SET time_zone = '-8:00'`);

    await next();

    req.db.release();
  } catch (err) {
    // If anything downstream throw an error, we must release the connection allocated for the request
    console.log(err)
    if (req.db) req.db.release();
    throw err;
  }
});

app.use(cors());

app.use(bodyParser.json());

app.post('/register', async function (req, res) {
  try {
    let user;

    // Hashes the password and inserts the info into the `user` table
    await bcrypt.hash(req.body.password, 10).then(async hash => {
      try {
        [user] = await req.db.query(`
          INSERT INTO user (username, email, password)
          VALUES (:username, :email, :password);
        `, {
          username: req.body.username,
          email: req.body.email,
          password: hash
        });

        console.log('user', user)
      } catch (error) {
        res.json('Error creating user');
        console.log('error', error)
      }
    });

    const encodedUser = jwt.sign(
      { 
        userId: user.insertId,
        ...req.body
      },
      process.env.JWT_KEY
    );

    res.json({
      data: encodedUser,
      error: false,
      msg: ''
    });
  } catch (err) {
    res.json({
      data: null,
      error: true,
      msg: 'Error, please try again'
    });
    console.log('err', err)
  }
});

app.post('/log-in', async function (req, res) {
  try {
    const [[user]] = await req.db.query(`
      SELECT * FROM user WHERE email = :email
    `, {  
      email: req.body.email
    });

    if (!user) {
      res.json({
        data: null,
        error: true,
        msg: 'Email not found'
      });
    }

    const userPassword = `${user.password}`

    const compare = await bcrypt.compare(req.body.password, userPassword);

    if (compare) {
      const payload = {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: 4
      }
      
      const encodedUser = jwt.sign(payload, process.env.JWT_KEY);

      res.json({
        data: encodedUser,
        error: false,
        msg: ''
      })
    } else {
      res.json({
        data: null,
        error: true,
        msg: 'Password not found'
      });
    }
  } catch (err) {
    res.json({
      data: null,
      error: true,
      msg: 'Error logging in'
    })
    console.log('Error in /log-in', err);
  }
});

// Jwt verification checks to see if there is an authorization header with a valid jwt in it.
app.use(async function verifyJwt(req, res, next) {
  try {
    if (!req.headers.authorization) {
      throw(401, 'Invalid authorization');
    }

    const [scheme, token] = req.headers.authorization.split(' ');

    if (scheme !== 'Bearer') {
      throw(401, 'Invalid authorization');
    }
  
    const payload = jwt.verify(token, process.env.JWT_KEY);

    req.user = payload;
  } catch (err) {
    if (err.message && (err.message.toUpperCase() === 'INVALID TOKEN' || err.message.toUpperCase() === 'JWT EXPIRED')) {

      req.status = err.status || 500;
      req.body = err.message;
      req.app.emit('jwt-error', err, req);
    } else {
      console.log()
      throw((err.status || 500), err.message);
    }
    console.log(err);
  }

  await next();
});

app.get('/emails', async function(req, res) {
  try {
    console.log('/emails success!', req.user);
    const [emails] = await req.db.query(
      `SELECT 
        id, 
        sender,
        recipient,
        subject,
        body,
        time_stamp AS timeStamp
      FROM emails WHERE recipient = :userEmail`,
      {
        userEmail: req.user.email
      }
    );

    res.json({
      data: emails,
      error: false,
      msg: ''
    });
  } catch (err) {
    console.log('Error in /emails', err);
    res.json({
      data: null,
      error: true,
      msg: 'Error fetching emails'
    });
  }
});

app.get('/view/emails:id', async function(req, res) {
  try {
    console.log('/view/emails success!', req.user);
    const [emails] = await req.db.query(
      `SELECT * FROM emails WHERE id = :userId`,
      {
        userId: req.params.id
      }
    );

    res.json({
      data: emails,
      error: false,
      msg: ''
    });
  } catch (err) {
    console.log('Error in /view/emails', err);
    res.json({
      data: null,
      error: true,
      msg: 'Error fetching emails'
    });
  }
});

app.put('/write/emails', async function(req, res) {
  console.log(req.user);
  try {
    await req.db.query(
      `INSERT INTO emails (
        sender,
        recipient,
        subject,
        body,
        time_stamp
      ) VALUES (
        :sender,
        :recipient,
        :subject,
        :body,
        NOW()
      )`,
      {
        
        sender: req.user.email,
        recipient: req.body.recipient,
        subject: req.body.subject,
        body: req.body.body
      }
    );

    res.json('/email success!');
  } catch (err) {
    console.log('Error in /email', err);
    res.json('Error sending email');
  }
});

/*app.post('/email', async function(req, res) {
  try {
    console.log('/emails success!');

    res.json('/emails success!')
  } catch (err) {
    
  }
});*/


app.delete('/delete/emails/:id', async function(req, res) {
  try {
    console.log('/delete/emails success!', req.user);
    const [emails] = await req.db.query(
      `DELETE FROM emails WHERE id = :userId`,
      {
        userId: req.params.id
      }
    );
 
    res.json({
      data: emails,
      error: false,
      msg: ''
    });
  } catch (err) {
    console.log('Error in /delete/emails', err);
    res.json({
      data: null,
      error: true,
      msg: 'Error deleting emails'
    });
  }
});
 
 
 /* try {
    await req.db.query(
      DELETE FROM emails WHERE id = userId`,
      {
        id: req.params.id
      }
    );
    res.json('/delete success!')
  } catch (err) {
    console.log("Error in /delete", err);
    res.json("Error deleting email");
  }
});*/

app.listen(port, () => console.log(`petalmail-api listening at http://localhost:${port}`));