import { createClient, RedisClientType } from "redis";

// Define a variable to hold the client instance
let client: RedisClientType | null = null;

export async function getRedisClient() {
  if (client) {
    // Return the existing client if it's already initialized
    return client;
  }
  // Create a new client instance if it's the first time this function is called
  client = createClient({ url: process.env.REDIS_URL || "" });

  client.on("error", (err) => console.log("Redis Client Error", err));

  // Connect to the Redis server
  await client.connect();

  return client;
}
