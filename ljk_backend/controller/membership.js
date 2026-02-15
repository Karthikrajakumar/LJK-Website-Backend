const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

require("dotenv").config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION,
});

const dynamoDB = DynamoDBDocumentClient.from(client);

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
});

const MEMBERSHIPTABLENAME = process.env.MEMBERSHIPTABLENAME;
const S3_BUCKET_NAME = process.env.S3_BUCKET_MEMBERSHIP;

const generateMembershipId = () => {
  const randomNumber = Math.floor(100000 + Math.random() * 900000);
  return `issue-${randomNumber}`;
};

/**
 * Upload file buffer to S3 (for multer uploads)
 * This is used when files come from multipart/form-data
 */
const uploadFileToS3 = async (fileBuffer, mimetype, membershipId) => {
  try {
    const extension = mimetype.split("/")[1];
    const fileName = `members/${membershipId}/profile.${extension}`;

    const uploadParams = {
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
      Body: fileBuffer,
      ContentType: mimetype,
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Return the S3 URL
    return `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error("S3 Upload Error (File Buffer):", error);
    throw new Error("Failed to upload photo to S3");
  }
};

/**
 * Upload base64 image to S3 (for base64 uploads)
 * This is used when photos come as base64 strings in JSON
 */
const uploadPhotoToS3 = async (base64Photo, membershipId) => {
  try {
    // Remove data URI prefix (e.g., "data:image/jpeg;base64,")
    const base64Data = base64Photo.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Detect image type from base64 string
    let contentType = "image/jpeg";
    if (base64Photo.includes("data:image/png")) {
      contentType = "image/png";
    } else if (base64Photo.includes("data:image/jpg")) {
      contentType = "image/jpeg";
    } else if (base64Photo.includes("data:image/webp")) {
      contentType = "image/webp";
    }

    const extension = contentType.split("/")[1];
    const fileName = `members/${membershipId}/profile.${extension}`;

    const uploadParams = {
      Bucket: S3_BUCKET_NAME,
      Key: fileName,
      Body: buffer,
      ContentType: contentType,
      ContentEncoding: "base64",
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // Return the S3 URL
    return `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
  } catch (error) {
    console.error("S3 Upload Error (Base64):", error);
    throw new Error("Failed to upload photo to S3");
  }
};

/**
 * Register a new member
 * Supports both:
 * 1. Multipart/form-data uploads (photo as file via multer)
 * 2. JSON uploads (photo as base64 string)
 */
const registerMember = async (req, res) => {
  try {
    const formData = req.body;

    const {
      name,
      email,
      mobileNumber,
      constituency,
      district,
      address,
      age,
      voterId,
      gender,
      boothNumber,
      commitment,
      dob,
      photo,
    } = formData;

    if (!name || !mobileNumber || !constituency || !voterId) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing",
        missing: {
          name: !name,
          mobileNumber: !mobileNumber,
          constituency: !constituency,
          voterId: !voterId,
        },
      });
    }

    const existingMember = await dynamoDB.send(
      new QueryCommand({
        TableName: MEMBERSHIPTABLENAME,
        IndexName: "mobileNumber-index",
        KeyConditionExpression: "mobileNumber = :mobileNumber",
        ExpressionAttributeValues: {
          ":mobileNumber": mobileNumber,
        },
      })
    );

    if (existingMember.Items && existingMember.Items.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Member already registered with this mobile number",
      });
    }

    if (!req.file && !photo) {
      return res.status(400).json({
        success: false,
        message: "Profile photo is required",
      });
    }

    if (age && (age < 18 || age > 120)) {
      return res.status(400).json({
        success: false,
        message: "Invalid age. Must be 18 or older.",
      });
    }

    const membershipId = generateMembershipId();

    let photoUrl = null;

    try {
      if (req.file) {
        photoUrl = await uploadFileToS3(
          req.file.buffer,
          req.file.mimetype,
          membershipId
        );
      } else if (photo) {
        photoUrl = await uploadPhotoToS3(photo, membershipId);
      }
    } catch (uploadError) {
      console.error("Photo upload failed:", uploadError);
      return res.status(500).json({
        success: false,
        message: "Failed to upload profile photo",
        error:
          process.env.NODE_ENV === "development"
            ? uploadError.message
            : undefined,
      });
    }

    const memberData = {
      membershipId,
      mobileNumber,
      name,
      email: email || null,
      age: age || null,
      dob: dob || null,
      voterId,
      constituency,
      district: district || null,
      address: address || null,
      gender: gender || null,
      boothNumber: boothNumber || null,
      commitment: commitment || null,
      photoUrl,
      isVerified: true,
      status: "Active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };


    await dynamoDB.send(
      new PutCommand({
        TableName: MEMBERSHIPTABLENAME,
        Item: memberData,
        ConditionExpression: "attribute_not_exists(membershipId)",
      })
    );

    return res.status(200).json({
      success: true,
      message: "Membership registered successfully",
      membershipId,
      data: {
        name: memberData.name,
        email: memberData.email,
        constituency: memberData.constituency,
        status: memberData.status,
        photoUrl: memberData.photoUrl,
      },
    });

  } catch (error) {
    console.error("Membership Registration Error:", error);

    if (error.name === "ConditionalCheckFailedException") {
      return res.status(409).json({
        success: false,
        message: "Membership ID already exists. Please try again.",
      });
    }

    if (error.name === "ValidationException") {
      return res.status(400).json({
        success: false,
        message: "Invalid data format",
        error: error.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Membership registration failed. Please try again later.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

/* ===== LIST MEMBERS ===== */
const listMember = async (req, res) => {
  try {
    const { constituency, limit = 50 } = req.query;

    const params = {
      TableName: MEMBERSHIPTABLENAME,
      Limit: parseInt(limit),
    };

    if (constituency) {
      params.FilterExpression = "constituency = :constituency";
      params.ExpressionAttributeValues = {
        ":constituency": constituency,
      };
    }

    const command = new ScanCommand(params);
    const data = await dynamoDB.send(command);

    return res.status(200).json({
      success: true,
      count: data.Items?.length || 0,
      members: data.Items || [],
    });
  } catch (error) {
    console.error("Membership Listing Error:", error);
    return res.status(500).json({
      success: false,
      message: "Membership listing failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

module.exports = { registerMember, listMember };