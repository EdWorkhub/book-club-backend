const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const { promisify } = require("util");

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

// Firebase Init and Login
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

// GET ALL Members
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

// GET Member by FirebaseUid
app.get("/members/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM members WHERE firebaseUid = ?", [id], (err, row) => {
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

// GET Member by local id
app.get("/local-members/:id", (req, res) => {
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

// GET All Books
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

// GET Book by ID 
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

// GET Member Currently Reading Books List 
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

// GET Member Reading History List 
app.get("/member_books_history/:id", (req, res) => {
  const id = req.params.id;
  db.all(
    "SELECT b.* FROM books b INNER JOIN member_books_history mbh ON b.id = mbh.book_id WHERE mbh.member_id = ?",
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

// GET Member Reported On Books (ever had report submitted against by Member)
app.get("/member_reported_books/:id", (req, res) => {
  const id = req.params.id;
  db.all(
    "SELECT b.* FROM books b INNER JOIN book_reports br ON b.id = br.book_id WHERE br.member_id = ?",
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

// POST Move from Currently Reading to Reading History (clones current row from member_books into member_books_history then deletes original row) 
app.post("/move-to-read", (req, res) => {
  const { bookId, memberId } = req.body;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION;");

    db.run(
      `INSERT OR IGNORE INTO member_books_history (book_id,   member_id)
       SELECT book_id, member_id
       FROM member_books
       WHERE book_id = ? AND member_id = ?`,
      [bookId, memberId]
    );

    db.run(
      `DELETE FROM member_books
       WHERE book_id = ? AND member_id = ?`,
      [bookId, memberId],
      function (err) {
        if (err) {
          db.run("ROLLBACK;");
          return res.status(500).send(err.message);
        }
        db.run("COMMIT;");
        res.send({ success: true });
      }
    );
  });
});

// GET All Book Reports
app.get("/book_reports", (req, res) => {
  db.all("SELECT * FROM book_reports_json", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    console.log(rows);
    res.json(rows);
  });
});

// GET All Book Reports by Book ID 
app.get("/book_reports/:id", (req, res) => {
  const id = req.params.id;
  db.all(
    "SELECT * FROM book_reports_json WHERE book_id = ?",
    [id],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(rows);
      res.json(rows);
    }
  );
});

// GET All Book Reports by Member ID 
app.get("/book_reports/:memberid", (req, res) => {
  const memberid = req.params.id;
  db.all(
    "SELECT * FROM book_reports_json WHERE member_id = ?",
    [memberid],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      console.log(rows);
      res.json(rows);
    }
  );
});


// POST New Book Report 
app.post("/book_reports", (req, res) => {
  const { answers, bookId, memberId } = req.body;

  db.run(
    "INSERT INTO book_reports (book_id, member_id) VALUES (?, ?)",
    [bookId, memberId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const reportId = this.lastID; // ID of the new report

      const stmt = db.prepare(
        "INSERT INTO book_report_answers (report_id, question, answer) VALUES (?, ?, ?)"
      );

      for (const { question, answer } of answers) {
        stmt.run(reportId, question, answer);
      }
      stmt.finalize((err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.status(201).json({ message: "Report saved", reportId });
      });
    }
  );
});

// POST Add Book to Member Currently Reading 
app.post("/member_books", (req, res) => {
  const { bookId, memberUid } = req.body;
  console.log("Receieved POST body: ", req.body);

  db.serialize(() => {
    db.run("BEGIN TRANSACTION;");

    db.run(
      "DELETE FROM member_books_history WHERE book_id = ? and member_id = ?",
      [bookId, memberUid],
      function (err) {
        if (err) {
          console.error("DB Insert Error: ", err.message);
          return res.status(500).json({ error: err.message });
        }
      }
    )
  })

  db.run(
    "INSERT INTO member_books (book_id, member_id) VALUES (?, ?)", 
    [bookId, memberUid],
    function (err) {
        if (err) {
          db.run("ROLLBACK;");
          return res.status(500).send(err.message);
        }
        db.run("COMMIT;");
        res.send({ success: true });
      }
  );
});

// POST Add New Member
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

// POST Add New Book to Library
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

/////// OpenLibrary API ///////

// GET Book Detail from /works/OLXXXXXX
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

// GET Edition Detail from /works/OLXXXXXX/edition.json
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

// GET Q Search Results 
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
