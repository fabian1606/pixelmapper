import app from "./src/server.js";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`AI Backend Service listening on port ${PORT}`);
});