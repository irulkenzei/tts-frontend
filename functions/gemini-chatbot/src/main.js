/*
mport { Client, Users } from 'node-appwrite';

// This Appwrite function will be executed every time your function is triggered
export default async ({ req, res, log, error }) => {
  // You can use the Appwrite SDK to interact with other services
  // For this example, we're using the Users service
  const client = new Client()
    .setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT)
    .setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID)
    .setKey(req.headers['x-appwrite-key'] ?? '');
  const users = new Users(client);

  try {
    const response = await users.list();
    // Log messages and errors to the Appwrite Console
    // These logs won't be seen by your end users
    log(`Total users: ${response.total}`);
  } catch(err) {
    error("Could not list users: " + err.message); 
  }

  // The req object contains the request data
  if (req.path === "/ping") {
    // Use res object to respond with text(), json(), or binary()
    // Don't forget to return a response!
    return res.text("Pong");
  }

  return res.json({
    motto: "Build like a team of hundreds_",
    learn: "https://appwrite.io/docs",
    connect: "https://appwrite.io/discord",
    getInspired: "https://builtwith.appwrite.io",
  });
};*/
import { GoogleGenerativeAI } from '@google/generative-ai';

export default async ({ req, res, log, error }) => {
  // Pastikan request adalah POST
  if (req.method === 'POST') {
    try {
      // Ambil prompt dari body request (dari frontend)
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const userPrompt = payload.prompt;

      if (!userPrompt) {
        return res.json({ error: "The prompt cannot be empty." }, 400);
      }

      // Ambil API Key dari Environment Variable Appwrite
      const apiKey = process.env.GEMINI_API_KEY;
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      log(`Memproses prompt: ${userPrompt}`);
      const result = await model.generateContent(userPrompt);
      const responseText = result.response.text();

      // Kembalikan respon ke frontend
      return res.json({ reply: responseText });

    } catch (err) {
      error(`Error dari Gemini: ${err.message}`);
      return res.json({ error: "Failed to process AI" }, 500);
    }
  }

  // Jika bukan POST request
  return res.json({ message: "Use the POST method." });
};
