const { Client } = require("pg");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const ses = new SESClient();

exports.handler = async () => {
  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || "5432", 10),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:
      process.env.DB_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined,
  });

  try {
    await client.connect();

    const { rows } = await client.query(
      "SELECT title, created_at FROM todos WHERE completed = false ORDER BY created_at DESC"
    );

    const count = rows.length;

    if (count === 0) {
      console.log("No incomplete todos. Skipping email.");
      return { statusCode: 200, body: "No incomplete todos" };
    }

    const lines = rows.map((row, i) => {
      const date = new Date(row.created_at).toISOString().split("T")[0];
      return `  ${i + 1}. ${row.title} (created ${date})`;
    });

    const body = [
      `You have ${count} incomplete todo${count === 1 ? "" : "s"}:`,
      "",
      ...lines,
      "",
      "Have a productive day!",
    ].join("\n");

    const subject = `Todo Summary: ${count} incomplete item${count === 1 ? "" : "s"}`;

    await ses.send(
      new SendEmailCommand({
        Source: process.env.SENDER_EMAIL,
        Destination: { ToAddresses: [process.env.RECIPIENT_EMAIL] },
        Message: {
          Subject: { Data: subject },
          Body: { Text: { Data: body } },
        },
      })
    );

    console.log(`Sent summary email: ${count} items`);
    return { statusCode: 200, body: `Sent summary: ${count} items` };
  } finally {
    await client.end();
  }
};
