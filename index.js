const express = require("express");
const cors = require("cors");
const stripe = require('stripe')('sk_test_51NUl13AM7dWCC5hhndzIZYPYWLCJW2p5XvLj7yual6PDrx5ny04SvuGff98o5Enn9tDWo8J5ll52gAoXP9nxQ0tv00t8SJTRkF');
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require('jsonwebtoken');
const port = process.env.PORT || 5000;
const app = express();

//middleware
app.use(cors());
app.use(express.json());





function verifyJWT(req, res, next){
  //console.log('accessToken', req.headers.authorization);
  const authHeader = req.headers.authorization;
  
  if(!authHeader){
    return res.status(401).send('unauthorized access');
  }

  const token = authHeader.split(' ')[1];
  //console.log('token:',token);
  jwt.verify(token,process.env.ACCESS_TOKEN, function(err, decoded){
    if(err){
      
      return res.status(403).send({message:`Forbidden Access`})
    }
    req.decoded = decoded;
    // console.log(req.decoded);
    next();
  })
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.eoflvcj.mongodb.net/?retryWrites=true&w=majority`;

//console.log(uri);
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const appointmentOptionCollection = client
      .db("doctorsPortal")
      .collection("appointmentOptions");
    const bookingsCollection = client
      .db("doctorsPortal")
      .collection("bookings");
    const usersCollection = client
      .db("doctorsPortal")
      .collection("users");
    const doctorsCollection = client
      .db("doctorsPortal")
      .collection("doctors");
    const paymentsCollection = client
      .db("doctorsPortal")
      .collection("payments");


      //NOTE: use verifyAdmin after verifyJwt

      const verifyAdmin = async (req, res, next) => {
        
        const decodedEmail = req.decoded.email;
        const query = {email: decodedEmail};
        const user = await usersCollection.findOne(query);
        if(user?.role !== 'admin'){
          return res.status(403).send({message: 'forbidden access'});
        }
          next();
      }

      
    app.get("/appointmentOptions", async (req, res) => {
      const date = req.query.date;

      const query = {};
      const options = await appointmentOptionCollection.find(query).toArray();

      //get the bookings of the provided date
      const bookingQuery = { appointmentDate: date };
      const alreadyBooked = await bookingsCollection
        .find(bookingQuery)
        .toArray();
      //console.log(alreadyBooked);

      options.forEach((option) => {
        const optionBooked = alreadyBooked.filter(
          (book) => book.treatment === option.name
        );
        const bookedSlots = optionBooked.map((book) => book.slot);
        const remainingSlots = option.slots.filter(
          (slot) => !bookedSlots.includes(slot)
        );
        option.slots = remainingSlots;
        // console.log(remainingSlots.length);
        // console.log(option.name, bookedSlots);
      });
      res.send(options);

    });


    //specific booking collections
    app.get('/bookings/:id', async (req, res )=> {
      const id = req.params.id;
      const query = {_id: new ObjectId(id)};
      const booking = await bookingsCollection.findOne(query);
      res.send(booking);
    })


    app.get('/bookings',verifyJWT, async (req, res) =>{
      const email = req.query.email;
      const decodedEmail = req.decoded.email;

      if(email !== decodedEmail){
        return res.status(403).send({message: 'forbidden access'});
      }
      const query = {email: email}
      const bookings = await bookingsCollection.find(query).toArray();
      res.send(bookings);
    })


    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      console.log(booking);
      const query = {
        appointmentDate: booking.appointmentDate,
        email: booking.email,
        treatment: booking.treatment
      }
      const alreadyBooked = await bookingsCollection.find(query).toArray();
      if(alreadyBooked.length){
        const message = `You Already have a booking on ${booking.appointmentDate}`
        return res.send({acknowledge: false, message})
      }

      const result = await bookingsCollection.insertOne(booking);
      res.send(result);
    });


    app.post('/create-payment-intent', async (req, res) => {
      const booking = req.body;
      const price = booking.price;
      const amount = price * 100;

      //console.log(amount);

      const paymentIntent = await stripe.paymentIntents.create({
        currency: 'usd',
        amount: amount,
        "payment_method_types": [
          "card"
        ]
      });

      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    })


    app.post('/payments', async (req, res) =>{
      const payment = req.body;
      const result = await paymentsCollection.insertOne(payment);
      const id = payment.bookingId;
      const filter = {_id: new ObjectId(id)};
      const updateDoc={
        $set: {
          paid: true,
          transactionId: payment.transactionId
        }
      }
      const updatedResult = await bookingsCollection.updateOne(filter,updateDoc);

      res.send(result);
    })
    

    
    app.get('/jwt', async(req, res) => {
      const email = req.query.email;
      const query = {email:email}
      const user = await usersCollection.findOne(query);
      if(user){
          const token = jwt.sign({email}, process.env.ACCESS_TOKEN,{expiresIn: '1h'})
          return res.send({accessToken: token});
      }
      console.log(user);
      res.status(403).send({accessToken: ''});

    })  


    app.get('/appointmentSpecialty', async (req, res) =>{
      const query ={};
      const result = await appointmentOptionCollection.find(query).project({name:1}).toArray();
      res.send(result);
    })


    app.get('/users', async(req, res) =>{
      const query={};
      const users = await usersCollection.find(query).toArray();
      res.send(users);
    })




    app.put('/users/admin/:id',verifyJWT, verifyAdmin,  async (req, res)=>{
      
      const id= req.params.id;
      console.log(id);
      const filter = {_id: new ObjectId(id)}
      const options = {upsert: true}
      const updateDoc = {
        $set:{
          role: 'admin'
        }
      }
      const result = await usersCollection.updateOne(filter,updateDoc, options);
      res.send(result);
    })



    //temporary update to appointmentOptionsCollections add price 

   {/**  app.get('/addPrice', async(req, res) =>{
      
      const filter = {}
      const options = {upsert: true}
      const updateDoc = {
        $set:{
          price: 500
        }
      }

      const result = await appointmentOptionCollection.updateMany(filter, updateDoc, options);
      res.send(result);
    }) */}

    


    
    
    app.get('/users/admin/:email', async (req, res) => {
      const email = req.params.email;
      const query = {email}
      const user = await usersCollection.findOne(query);
      res.send({ isAdmin: user?.role === 'admin' });
    })



    app.post('/users', async(req, res) =>{
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
    })


    app.get('/doctors', verifyJWT,verifyAdmin, async (req, res) =>{
      const query = {};
      const doctors =  await  doctorsCollection.find(query).toArray();
      res.send(doctors);
    })

    //add doctor 
    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) =>{
          const doctor = req.body;
          const result = await doctorsCollection.insertOne(doctor);
          res.send(result);
    })
    
    //delete doctor 
    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res)=>{
      const id = req.params.id;
      const filter = {_id : new ObjectId(id)};
      const result = await doctorsCollection.deleteOne(filter);
      res.send(result);
    })
   

    
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("doctors portal server is running");
});

app.listen(port, () => console.log(`Doctors portal running on ${port}`));
