const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  TransactWriteCommand
} = require("@aws-sdk/lib-dynamodb");
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const path = require("path");

require("dotenv").config();

/* AWS clients */
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const dynamoDB = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION })
);



/* Multer config */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("Only image and video files are allowed"));
  }
});

/* ===== SUBMIT GRIEVANCE ===== */
const submitGrievance = async (req, res) => {
  try {
    const {
      fullName,
      mobileNumber,
      constituency,
      area,
      street,
      category,
      description
    } = req.body;

    if (!fullName || !mobileNumber || !constituency || !area || !street || !category || !description) {
      return res.status(400).json({
        success: false,
        message: "All fields are required"
      });
    }

    const files = req.files;
    const evidenceFiles = [];

    if (files && files.length > 0) {
      for (const file of files) {
        const fileExt = path.extname(file.originalname);
        const key = `grievances/${Date.now()}-${Math.round(Math.random() * 1e9)}${fileExt}`;

        await s3.send(
          new PutObjectCommand({
            Bucket: process.env.S3_BUCKET_GRIEVANCE,
            Key: key,
            Body: file.buffer,
            ContentType: file.mimetype,
          })
        );

        evidenceFiles.push(
          `https://${process.env.S3_BUCKET_GRIEVANCE}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
        );
      }
    }

    const trackingId = `Issue-${Math.floor(100000 + Math.random() * 900000)}`;
    const timestamp = new Date().toISOString();

    await dynamoDB.send(
      new PutCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        Item: {
          trackingId,
          timestamp,
          fullName,
          mobileNumber,
          constituency,
          area,
          street,
          category,
          description,
          evidenceFiles,
          status: "Submitted",
          remarks: "",
          assignedTo: "",
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      })
    );

    res.status(200).json({
      success: true,
      message: "Grievance submitted successfully",
      trackingId
    });
  } catch (error) {
    console.error("Grievance Submission Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit grievance",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== TRACK GRIEVANCE ===== */
const trackGrievance = async (req, res) => {
  try {
    const { trackingId } = req.params;
    console.log("Tracking grievance with ID:", trackingId);

    const result = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: {
          ":tid": trackingId,
        },
      })
    );

    console.log("DynamoDB query result:", result);

    if (!result.Items || result.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found"
      });
    }

    res.status(200).json({
      success: true,
      grievance: result.Items[0],
    });
  } catch (error) {
    console.error("Track Grievance Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to track grievance",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== LIST GRIEVANCES ===== */
const listGrievances = async (req, res) => {
  try {
    const { status, constituency, limit = 50 } = req.query;

    let params = {
      TableName: process.env.GRIEVANCE_TABLENAME,
      Limit: parseInt(limit),
    };

    if (status || constituency) {
      let filterExpressions = [];
      let expressionAttributeValues = {};

      if (status) {
        filterExpressions.push("#status = :status");
        expressionAttributeValues[":status"] = status;
      }

      if (constituency) {
        filterExpressions.push("constituency = :constituency");
        expressionAttributeValues[":constituency"] = constituency;
      }

      params.FilterExpression = filterExpressions.join(" AND ");
      params.ExpressionAttributeValues = expressionAttributeValues;
      
      if (status) {
        params.ExpressionAttributeNames = { "#status": "status" };
      }
    }

    const result = await dynamoDB.send(new ScanCommand(params));

    res.status(200).json({
      success: true,
      grievances: result.Items || [],
      count: result.Items?.length || 0,
    });
  } catch (error) {
    console.error("List Grievances Error:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to list grievances",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== UPDATE GRIEVANCE ===== */
const updateGrievanceStatus = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { status, remarks, assignedTo } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required"
      });
    }

    const queryResult = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: {
          ":tid": trackingId,
        },
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found"
      });
    }

    const existingItem = queryResult.Items[0];

    const updateParams = {
      TableName: process.env.GRIEVANCE_TABLENAME,
      Key: {
        trackingId: trackingId,
        timestamp: existingItem.timestamp,
      },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":updatedAt": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    };

    if (remarks !== undefined) {
      updateParams.UpdateExpression += ", remarks = :remarks";
      updateParams.ExpressionAttributeValues[":remarks"] = remarks;
    }

    if (assignedTo !== undefined) {
      updateParams.UpdateExpression += ", assignedTo = :assignedTo";
      updateParams.ExpressionAttributeValues[":assignedTo"] = assignedTo;
    }

    const result = await dynamoDB.send(new UpdateCommand(updateParams));

    res.status(200).json({
      success: true,
      message: "Grievance updated successfully",
      grievance: result.Attributes,
    });
  } catch (error) {
    console.error("Update Grievance Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update grievance",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== DELETE GRIEVANCE ===== */
const deleteGrievance = async (req, res) => {
  try {
    const { trackingId } = req.params;

    const queryResult = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: {
          ":tid": trackingId,
        },
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found"
      });
    }

    const item = queryResult.Items[0];

    if (item.evidenceFiles && item.evidenceFiles.length > 0) {
      for (const fileUrl of item.evidenceFiles) {
        const key = fileUrl.split('.com/')[1];

        await s3.send(
          new DeleteObjectCommand({
            Bucket: process.env.S3_BUCKET_GRIEVANCE,
            Key: key,
          })
        );
      }
    }

    await dynamoDB.send(
      new DeleteCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        Key: {
          trackingId: trackingId,
          timestamp: item.timestamp,
        },
      })
    );

    res.status(200).json({
      success: true,
      message: "Grievance deleted successfully",
      trackingId,
    });
  } catch (error) {
    console.error("Delete Grievance Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete grievance",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== STATISTICS ===== */
const getStatistics = async (req, res) => {
  try {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
      })
    );

    const items = result.Items || [];

    const stats = {
      total: items.length,
      byStatus: {},
      byConstituency: {},
      byCategory: {},
    };

    items.forEach(item => {
      stats.byStatus[item.status] = (stats.byStatus[item.status] || 0) + 1;
      stats.byConstituency[item.constituency] = (stats.byConstituency[item.constituency] || 0) + 1;
      stats.byCategory[item.category] = (stats.byCategory[item.category] || 0) + 1;
    });

    res.status(200).json({
      success: true,
      statistics: stats
    });
  } catch (error) {
    console.error("Statistics Error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get statistics",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined
    });
  }
};

/* ===== SAVE LEADER COMMENT ===== */
const saveLeaderComment = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { text } = req.body;

    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: "Comment text is required",
      });
    }

    // Find grievance by trackingId (same pattern you already use)
    const queryResult = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: { ":tid": trackingId },
        Limit: 1,
      })
    );

    if (!queryResult.Items?.length) {
      return res.status(404).json({
        success: false,
        message: "Grievance not found",
      });
    }

    const existing = queryResult.Items[0];

    const now = new Date().toISOString();

    const result = await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        Key: {
          trackingId,
          timestamp: existing.timestamp,
        },
        UpdateExpression:
          "SET leaderComment = :c, leaderCommentUpdatedAt = :u, updatedAt = :u",
        ExpressionAttributeValues: {
          ":c": text.trim(),
          ":u": now,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return res.status(200).json({
      success: true,
      message: "Leader comment saved",
      grievance: result.Attributes,
    });
  } catch (error) {
    console.error("Save Leader Comment Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to save leader comment",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
};

const assignAgentToGrievance = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { agentId, agentName } = req.body;

    if (!trackingId) {
      return res.status(400).json({ success: false, message: "trackingId is required" });
    }

    if (!agentId) {
      return res.status(400).json({ success: false, message: "agentId is required" });
    }

    // 1) Find grievance item (you store with PK=trackingId + SK=timestamp)
    const queryResult = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: { ":tid": trackingId },
        Limit: 1,
      })
    );

    if (!queryResult.Items?.length) {
      return res.status(404).json({ success: false, message: "Grievance not found" });
    }

    const grievanceItem = queryResult.Items[0];

    // 2) Check agent exists
    const agentResp = await dynamoDB.send(
      new GetCommand({
        TableName: process.env.AGENTS_TABLENAME,
        Key: { agentId }, // ✅ agent table PK
      })
    );

    if (!agentResp.Item) {
      return res.status(404).json({ success: false, message: "Agent not found" });
    }

    const now = new Date().toISOString();

    // Build a nice readable task text for agent
    const taskText = `${grievanceItem.category || "Issue"} - ${grievanceItem.area || ""}${grievanceItem.street ? ", " + grievanceItem.street : ""}`.trim();

    // 3) Transaction: update grievance + update agent
    const tx = new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: process.env.GRIEVANCE_TABLENAME,
            Key: { trackingId, timestamp: grievanceItem.timestamp },
            UpdateExpression:
              "SET #status = :s, assignedTo = :a, assignedAgentName = :n, updatedAt = :u",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              // ✅ choose your status string
              // If your UI maps "In Progress" => process, use that.
              // If you want "Assigned", keep "Assigned".
              ":s": "In Progress",
              ":a": agentId,
              ":n": agentName || agentResp.Item.name || "",
              ":u": now,
            },
          },
        },
        {
          Update: {
            TableName: process.env.AGENTS_TABLENAME,
            Key: { agentId },
            UpdateExpression:
              "SET #status = :st, currentTaskTrackingId = :tid, currentTaskText = :txt, updatedAt = :u",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":st": "active",
              ":tid": trackingId,
              ":txt": taskText,
              ":u": now,
            },
          },
        },
      ],
    });

    await dynamoDB.send(tx);

    return res.status(200).json({
      success: true,
      message: "Agent assigned successfully",
      assignedTo: agentId,
      grievanceId: trackingId,
      agentStatus: "active",
      grievanceStatus: "In Progress",
    });
  } catch (error) {
    console.error("Assign Agent Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to assign agent",
      error: process.env.NODE_ENV !== "production" ? error.message : undefined,
    });
  }
};


const uploadProofAndResolve = async (req, res) => {
  try {
    const { trackingId } = req.params;
    const { note = "" } = req.body;

    const queryResult = await dynamoDB.send(
      new QueryCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        KeyConditionExpression: "trackingId = :tid",
        ExpressionAttributeValues: { ":tid": trackingId },
        Limit: 1,
      })
    );

    if (!queryResult.Items?.length) {
      return res.status(404).json({ success: false, message: "Grievance not found" });
    }

    const existing = queryResult.Items[0];

    let proofUrl = "";
    if (req.file?.buffer) {
      const fileExt = path.extname(req.file.originalname);
      const key = `grievance-proof/${trackingId}/${Date.now()}-${Math.round(
        Math.random() * 1e9
      )}${fileExt}`;

      await s3.send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET_GRIEVANCE,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        })
      );

      proofUrl = `https://${process.env.S3_BUCKET_GRIEVANCE}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    }

    const prevProof = Array.isArray(existing.proofFiles) ? existing.proofFiles : [];
    const proofFiles = proofUrl ? [...prevProof, proofUrl] : prevProof;

    const result = await dynamoDB.send(
      new UpdateCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
        Key: { trackingId, timestamp: existing.timestamp },
        UpdateExpression:
          "SET #status = :s, publicNote = :n, proofFiles = :p, updatedAt = :u",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: {
          ":s": "Resolved",
          ":n": String(note).trim(),
          ":p": proofFiles,
          ":u": new Date().toISOString(),
        },
        ReturnValues: "ALL_NEW",
      })
    );

    return res.status(200).json({
      success: true,
      message: "Resolved with proof",
      grievance: result.Attributes,
    });
  } catch (error) {
    console.error("Upload Proof Error:", error);
    return res.status(500).json({ success: false, message: "Failed to upload proof" });
  }
};



/* ===== EXPORT CSV (ALL GRIEVANCES) ===== */
const exportCsv = async (req, res) => {
  try {
    const result = await dynamoDB.send(
      new ScanCommand({
        TableName: process.env.GRIEVANCE_TABLENAME,
      })
    );

    const items = result.Items || [];

    const safe = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

    const header = [
      "trackingId",
      "timestamp",
      "fullName",
      "mobileNumber",
      "constituency",
      "area",
      "street",
      "category",
      "status",
      "leaderComment",
      "description",
    ].join(",");

    const rows = items.map((g) =>
      [
        g.trackingId,
        g.timestamp,
        g.fullName,
        g.mobileNumber,
        g.constituency,
        g.area,
        g.street,
        g.category,
        g.status,
        g.leaderComment,
        g.description,
      ]
        .map(safe)
        .join(",")
    );

    const csv = header + "\n" + rows.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=grievances.csv");
    return res.status(200).send(csv);
  } catch (error) {
    console.error("Export CSV Error:", error);
    return res.status(500).json({ success: false, message: "Failed to export csv" });
  }
};





// EXPORT ALL FUNCTIONS
module.exports = {
  submitGrievance,
  trackGrievance,
  listGrievances,
  updateGrievanceStatus,
  deleteGrievance,
  getStatistics,
  saveLeaderComment,
  assignAgentToGrievance,
  uploadProofAndResolve,
  exportCsv,
  upload,
}