const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const { promisify } = require('util');

// Firebase Auth
const admin = require("firebase-admin");
const serviceAccount = "./service-account-private.json";

// Create Express Instance
const app = express();
// Allow frontend connection
app.use(cors());
// Allow JSON interactions
app.use(express.json());
// Initalize Firebase Connection
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Connect to Sqlite3 DB (test.db)
const db = new sqlite3.Database("./test.db", (err) => {
  if (err) {
    console.error("Could not connect to DB", err);
  } else {
    console.log("Connected to SQlite3 DB!");
  }
});

// Allow async db callbacks as promises 
const getAsync = promisify(db.get.bind(db));

let lastMember;

// Test Firebase Auth via IDToken
app.post("/api/auth/firebase-login", async (req, res) => {
  console.log("In Backend");
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: "ID Token Missing" });
  }

  try {
    // Check user IDToken against Firebase Auth
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email, name, picture } = decodedToken;
    console.log(
      decodedToken.uid,
      decodedToken.email,
      decodedToken.name,
      decodedToken.picture
    );

    // Local DB check
    let member = await findMemberByUid(uid);

    // If does not exist in Local DB, create new profile
    if (!member) {
      console.log("User not found, creating new user");
      member = await createMember({
        uid,
        email,
        name,
        // Mismatched Firebase and DB val
        photoUrl: picture,
      });
    } else {
      return res.json(member);
    }
  } catch (err) {
    console.error("Firebase token verification failed:", err);
    return res.status(401).json({ error: "Invalid ID Token" });
  }
});

// Check local DB for member during verification
async function findMemberByUid(uid) {
  const query = `SELECT * FROM members WHERE firebaseUid = ?`;
  const member = await getAsync(query, [uid]);
  console.dir(member, { depth: null, colors: true });
  if (!member || !member.firebaseUid) {
    return null;
  }
  return member;
}

async function createMember(memberData) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO members (name, email, photoUrl, firebaseUid) VALUES (?, ?, ?, ?)`,
      [
        memberData.name || "",
        memberData.email || "",
        memberData.photoUrl,
        memberData.uid,
      ],
      function (err) {
        if (err) return reject(err);
        // Doing this to have access to most recently added member detail, this.lastID is the most recent rowID added to table
        db.get(
          `SELECT * FROM members WHERE id = ?`,
          [this.lastID],
          (err, row) => {
            if (err) return reject(err);
            resolve(row);
          },
          (this.lastMember = this.lastID)
        );
      }
    );
  });
}

// Test Route
app.get("/", (req, res) => {
  res.send("Backend connected!");
});

// Get all rows from 'members' tables
// Creates new endpoint at /members
app.get("/members", (req, res) => {
  db.all("SELECT * FROM members", [], (err, rows) => {
    if (err) {
      res.status(500).json({ err: err.message });
      return;
    }
    console.log(rows);
    res.json(rows);
  });
});

app.get("/members/:id", (req, res) => {
  const id = req.params.id;

  db.get("SELECT * FROM members WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Member not found" });
      return;
    }
    res.json(row);
  });
});

// Get all rows from 'books' table
// Creates new endpoint at /books
app.get("/books", (req, res) => {
  db.all("SELECT * FROM books", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(rows);
    res.json(rows);
  });
});

app.get("/books/:id", (req, res) => {
  // Not passing in query string, passing as parameter for get vs all!
  const id = req.params.id;

  db.get("SELECT * FROM books WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) {
      res.status(404).json({ error: "Book not found" });
      return;
    }
    res.json(row);
  });
});

app.get("/member_books/:id", (req, res) => {
  const id = req.params.id;
  db.all(
    "SELECT b.* FROM books b INNER JOIN member_books mb ON b.id = mb.book_id WHERE mb.member_id = ?",
    [id],
    (err, row) => {
      if (err) {
        console.error(err);
        return;
      }
      console.log(row);
      res.json(row);
    }
  );
});

app.post("/members", (req, res) => {
  const { name, role, team, email, location, joinDate, photoUrl, status } =
    req.body;
  console.log("Recieved POST body: ", req.body);

  if (!name) {
    return res.status(400).json({ error: "Missing Title" });
  }

  db.run(
    "INSERT INTO members (name, role, team, email, location, joinDate, photoUrl, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      name || "",
      role || "",
      team || "",
      email || "",
      location || "",
      joinDate || "",
      photoUrl || "",
      status || "",
    ],
    function (err) {
      if (err) {
        console.error("DB Insert Error: ", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log("Inserted Row ID: ", this.lastID);
      res.json({ id: this.lastID, changes: this.changes });
    }
  );
});

app.post("/books", (req, res) => {
  const { olid, title, author, description, published, imageUrl, pages, isbn } =
    req.body;
  console.log("Recieved POST body: ", req.body);

  if (!title) {
    return res.status(400).json({ error: "Missing Title" });
  }

  db.run(
    "INSERT INTO books (olid, title, author, description, published, imageUrl, pages, isbn) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      olid || "",
      title || "",
      author || "",
      description || "",
      published || "",
      imageUrl || "",
      pages || "",
      isbn || "",
    ],
    function (err) {
      if (err) {
        console.error("DB Insert Error: ", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log("Inserted Row ID: ", this.lastID);
      res.json({ id: this.lastID, changes: this.changes });
    }
  );
});

// OpenLibrary Testing
// Get book detail from /works/OLXXXXXX
app.get("/api/books/works/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "No id found" });
  }

  try {
    const openLibraryResponse = await fetch(
      `https://openlibrary.org/works/${id}.json`
    );
    // Response Data to handle as JSON
    const bookDetail = await openLibraryResponse.json();

    // Get Author Data as not plaintext in Book Detail
    if (bookDetail.authors && bookDetail.authors.length > 0) {
      const authorPromises = bookDetail.authors.map((a) =>
        fetch(`https://openlibrary.org${a.author.key}.json`).then((r) =>
          r.json()
        )
      );

      bookDetail.fullAuthors = await Promise.all(authorPromises);
    } else {
      bookDetail.fullAuthors = [];
    }

    res.json(bookDetail);
  } catch (err) {
    console.error("Error fetching API data:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Get edition detail from /works/OLXXXXXX/edition.json
app.get("/api/books/works/:id/editions.json", async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "No id found" });
  }

  try {
    const openLibraryResponse = await fetch(
      `https://openlibrary.org/works/${id}/editions.json`
    );
    // Response Data to handle as JSON
    const editionDetail = await openLibraryResponse.json();

    res.json(editionDetail);
  } catch (err) {
    console.error("Error fetching API data:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Get book detail from /works

// New endpoint at /api/books
// Generic q Search
app.get("/api/books", async (req, res) => {
  // Query should be text passed in whatever format from search
  const { search, title, author } = req.query;

  // if query missing (rules?) return
  if (!search && !title && !author) {
    return res.status(400).json({ error: "At least one search term required" });
  }

  // Build query string
  let queryString = "";
  // If no details just perform generic search
  if (search && !title && !author) {
    queryString = `q=${encodeURIComponent(search)}`;
  } else {
    // otherwise push specific values as query params
    const params = [];
    if (title) params.push(`title=${encodeURIComponent(title)}`);
    if (author) params.push(`author=${encodeURIComponent(author)}`);
    // join params w/ & to delineate
    queryString = params.join("&");
  }

  // Call openLibrary API
  try {
    const openLibraryResponse = await fetch(
      `https://openlibrary.org/search.json?${queryString}`
      // encodeURIComponent escapes spaces and special characters - essential for search queries
      // i.e "harry potter" -> "harry%20potter"
    );

    // Response Data to handle as JSON
    const openLibraryData = await openLibraryResponse.json();

    // Create books objects based on results 0-20 from JSON response -> each book then maps to a "card"
    const books = openLibraryData.docs.slice(0, 20).map((doc) => ({
      title: doc.title,
      // If more than one author join or provide placeholder if missing / invalid (lots of junk data in OL)
      author: doc.author_name ? doc.author_name.join(", ") : "Unknown Author",
      coverUrl: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : null,
      year: doc.first_publish_year || "N/A",
      olid: doc.key,
    }));

    // Returns JSON of books values to FE
    res.json(books);
  } catch (err) {
    console.error("Error fetching API data:", err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Server Instantiation
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
