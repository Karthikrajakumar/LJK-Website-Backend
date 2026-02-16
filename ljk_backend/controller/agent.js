const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

require("dotenv").config();

const dynamoDB = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);

const AGENTS_TABLE = process.env.AGENTS_TABLENAME;

function nowIso() {
  return new Date().toISOString();
}

exports.listAgents = async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: AGENTS_TABLE,
        Limit: parseInt(limit),
      })
    );

    return res.json({ success: true, agents: result.Items || [] });
  } catch (error) {
    console.error("List Agents Error:", error);
    return res.status(500).json({ success: false, message: "Failed to list agents" });
  }
};

exports.createAgent = async (req, res) => {
  try {
    const { name, ward, phone, status = "active" } = req.body;

    if (!name || !ward || !phone) {
      return res.status(400).json({ success: false, message: "name, ward, phone required" });
    }

    const agentId = `agent-${Date.now()}`;
    const timestamp = nowIso();

    const item = {
      agentId,
      name: String(name).trim(),
      ward: String(ward).trim(),
      phone: String(phone).trim(),
      status: status === "idle" ? "idle" : "active",
      currentTaskText: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await dynamoDB.send(
      new PutCommand({
        TableName: AGENTS_TABLE,
        Item: item,
      })
    );

    return res.status(201).json({ success: true, agent: item });
  } catch (error) {
    console.error("Create Agent Error:", error);
    return res.status(500).json({ success: false, message: "Failed to create agent" });
  }
};

exports.updateAgent = async (req, res) => {
  try {
    const { agentId } = req.params;
    const { name, ward, phone, status, currentTaskText } = req.body;

    // build dynamic update
    const sets = [];
    const values = { ":u": nowIso() };
    const names = {};

    if (name !== undefined) { sets.push("#n = :n"); names["#n"] = "name"; values[":n"] = String(name).trim(); }
    if (ward !== undefined) { sets.push("ward = :w"); values[":w"] = String(ward).trim(); }
    if (phone !== undefined) { sets.push("phone = :p"); values[":p"] = String(phone).trim(); }
    if (status !== undefined) { sets.push("#s = :s"); names["#s"] = "status"; values[":s"] = status === "idle" ? "idle" : "active"; }
    if (currentTaskText !== undefined) { sets.push("currentTaskText = :c"); values[":c"] = String(currentTaskText).trim(); }

    sets.push("updatedAt = :u");

    const result = await dynamoDB.send(
      new UpdateCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId },
        UpdateExpression: "SET " + sets.join(", "),
        ExpressionAttributeNames: Object.keys(names).length ? names : undefined,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );

    return res.json({ success: true, agent: result.Attributes });
  } catch (error) {
    console.error("Update Agent Error:", error);
    return res.status(500).json({ success: false, message: "Failed to update agent" });
  }
};

exports.deleteAgent = async (req, res) => {
  try {
    const { agentId } = req.params;

    await dynamoDB.send(
      new DeleteCommand({
        TableName: AGENTS_TABLE,
        Key: { agentId },
      })
    );

    return res.json({ success: true, message: "Agent deleted", agentId });
  } catch (error) {
    console.error("Delete Agent Error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete agent" });
  }
};
