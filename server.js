const express = require("express");
const cors = require("cors");
const midtransClient = require("midtrans-client");
const admin = require("firebase-admin");
require("dotenv").config();

try {
  const serviceAccount = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error("Firebase Admin SDK initialization error:", error.message);
}

const db = admin.firestore();

const app = express();

const allowedOrigins = [
  "https://ecom-dik.vercel.app",
  "http://localhost:5173",
];
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type,Authorization",
  credentials: true,
};
app.use(cors(corsOptions));

app.use(express.json());

const coreApi = new midtransClient.CoreApi({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

const snap = new midtransClient.Snap({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

app.post("/api/create-transaction", async (req, res) => {
  try {
    const { order_id, gross_amount, name, email } = req.body;

    const parameter = {
      transaction_details: {
        order_id: order_id,
        gross_amount: gross_amount,
      },
      customer_details: {
        first_name: name,
        email: email,
      },
    };

    const transaction = await snap.createTransaction(parameter);
    res.json({ token: transaction.token });
  } catch (error) {
    console.error(
      "Midtrans Create Transaction Error:",
      error.ApiResponse || error.message,
    );
    const status = error.httpStatusCode || 500;
    const message =
      error.ApiResponse?.error_messages?.[0] || "Gagal membuat transaksi.";
    res.status(status).json({ message });
  }
});

app.get("/api/check-status/:orderId", async (req, res) => {
  try {
    const midtransOrderId = req.params.orderId;
    const midtransResponse = await coreApi.transaction.status(midtransOrderId);

    const transactionStatus = midtransResponse.transaction_status;
    let newStatus = "Menunggu Konfirmasi";

    if (transactionStatus === "settlement" || transactionStatus === "capture") {
      newStatus = "Sudah dibayar";
    } else if (
      transactionStatus === "expire" ||
      transactionStatus === "cancel" ||
      transactionStatus === "deny"
    ) {
      newStatus = "Gagal";
    }

    const ordersRef = db.collection("orders");
    const querySnapshot = await ordersRef
      .where("snap_result.order_id", "==", midtransOrderId)
      .get();

    if (!querySnapshot.empty) {
      const orderDoc = querySnapshot.docs[0];
      await orderDoc.ref.update({ status: newStatus });
    }

    res.status(200).json({ new_status: newStatus });
  } catch (error) {
    console.error(
      "Error checking Midtrans status:",
      error.ApiResponse || error.message,
    );
    const status = error.httpStatusCode || 500;
    const message =
      error.ApiResponse?.status_message || "Gagal memeriksa status.";
    res.status(status).json({ message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Midtrans API running at http://localhost:${PORT}`);
});
