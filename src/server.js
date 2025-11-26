import dotenv from 'dotenv';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import * as yup from 'yup';
import bcrypt from 'bcrypt';
import multer from 'multer';
import cors from 'cors';
import jsonwebtoken from 'jsonwebtoken';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import { isAuth } from './middlewares/is-auth.js';
import { uploadFile } from './aws/S3.js';
import bodyParser from 'body-parser';

dotenv.config();

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Simple API',
            version: '1.0.0',
            description: 'A simple API with user authentication and posts',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server',
            },
            {
                url: 'https://simple-api-ngvw.onrender.com',
                description: 'ALUNOS',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
    },
    apis: ['./src/server.js'],
};

const swaggerDocs = swaggerJsdoc(swaggerOptions);

console.log({
    ENV: process.env.NODE_ENV,
    PORT: process.env.PORT,
    DATABASE_URL: process.env.DATABASE_URL,
    APP_SECRET: process.env.APP_SECRET,
    HASH_SECRET: process.env.HASH_SECRET,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
})

const prisma = new PrismaClient({
    log: ['query', 'info', 'warn', 'error'],
})

const userSchema = yup.object({
    name: yup.string().required('Name is required').min(2, 'Name must be at least 2 characters'),
    email: yup.string().required('Email is required').email('Invalid email format'),
    password: yup.string().required('Password is required').min(6, 'Password must be at least 6 characters')
});

const loginSchema = yup.object({
    email: yup.string().required('Email is required').email('Invalid email format'),
    password: yup.string().required('Password is required')
});

// const postSchema = yup.object({
//     title: yup.mixed().test('is-string', 'Title must be a string', value => typeof value === 'string')
//         .required('Title is required')
//         .min(3, 'Title must be at least 3 characters'),
//     content: yup.mixed().test('is-string', 'Content must be a string', value => typeof value === 'string')
//         .required('Content is required')
//         .min(10, 'Content must be at least 10 characters')
// });

const validate = (schema) => async (req, res, next) => {
    try {
        await schema.validate(req.body, { abortEarly: false });
        next();
    } catch (err) {
        if (err instanceof yup.ValidationError) {
            return res.status(400).json({ 
                error: 'Validation failed',
                details: err.errors 
            });
        }
        next(err);
    }
};

const upload = multer({ dest: 'uploads/' })

const app = express();

app.use(express.json());
app.use(express.urlencoded({
    extended: false
}));
app.use(bodyParser.json());

app.use(cors());

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));

/**
 * @swagger
 * /healthcheck:
 *   get:
 *     summary: Check if the API is running
 *     responses:
 *       200:
 *         description: API is running
 */
app.get('/healthcheck', (req, res) => {
    res.send('OK');
});

/**
 * @swagger
 * /users:
 *   post:
 *     summary: Create a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - email
 *               - password
 *             properties:
 *               name:
 *                 type: string
 *                 minLength: 2
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *                 minLength: 6
 *     responses:
 *       201:
 *         description: User created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: User with this email already exists
 */
app.post('/users', validate(userSchema), async (req, res) => {
    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
        where: {
            email: email,
        },
    });

    if (existingUser) {
        return res.status(409).json({ error: 'User with this email already exists' });
    }

    const encrypted = bcrypt.hashSync("CHAVE" + password, 10);
    console.log({ encrypted });

    
    await prisma.user.create({
        data: {
            name,
            email,
            password: encrypted,
        },
    });

    res.status(201).send();
});

/**
 * @swagger
 * /users:
 *   get:
 *     summary: Get all users
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 count:
 *                   type: integer
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       email:
 *                         type: string
 *       401:
 *         description: Unauthorized
 */
app.get('/users', isAuth, async (req, res) => {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    
    const users = await prisma.user.findMany({
        skip: (page - 1) * limit,
        take: +limit,
        select: {
            name: true,
            email: true,
        },
    });

    const count = await prisma.user.count();
    res.json({count, users});
});

/**
 * @swagger
 * /my-posts:
 *   get:
 *     summary: Get current user's posts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of user's posts
 *       401:
 *         description: Unauthorized
 */
app.get('/my-posts', isAuth, async (req, res) => {
    const posts = await prisma.post.findMany({
        where: {
            authorId: req.user.id,
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    const url = (id) => `https://tads-2025-apps.s3.us-east-1.amazonaws.com/${id}`;
    posts.forEach(post => {
        post.imageId = url(post.imageId);
    });

    return res.json(posts);
});    

/**
 * @swagger
 * /posts:
 *   get:
 *     summary: Get all posts
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of items per page
 *     responses:
 *       200:
 *         description: List of posts
 *       401:
 *         description: Unauthorized
 */
app.get('/posts', isAuth, async (req, res) => {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;

    const posts = await prisma.post.findMany({
        skip: (page - 1) * limit,
        take: +limit,
        include: {
            author: {
                select: {
                    name: true,
                    email: true,
                },
            }
        },
        orderBy: {
            createdAt: 'desc',
        },
    });

    const count = await prisma.post.count();

    const url = (id) => `https://tads-2025-apps.s3.us-east-1.amazonaws.com/${id}`;
    posts.forEach(post => {
        post.imageId = url(post.imageId);
    });

    res.json({count, posts});
});

/**
 * @swagger
 * /login:
 *   post:
 *     summary: Login user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   type: object
 *                 jwt:
 *                   type: string
 *       400:
 *         description: Invalid credentials
 *       404:
 *         description: User not found
 */
app.post('/login', validate(loginSchema), async (req, res) => {
    const { email, password } = req.body;
    console.log({ email, password });

    const user = await prisma.user.findUnique({
        where: {
            email: email,
        },
    });

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    console.log({ user })

    const isValid = bcrypt.compareSync("CHAVE"+ password, user.password);
    if (!isValid) {
        return res.status(400).json({ error: 'invalid credentials' });
    }
 
    const jwt = jsonwebtoken.sign(user, process.env.APP_SECRET, { expiresIn: '1d' });

    return res.json({ user, jwt });
});

/**
 * @swagger
 * /posts:
 *   post:
 *     summary: Create a new post
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *               - foto
 *             properties:
 *               title:
 *                 type: string
 *                 minLength: 3
 *               content:
 *                 type: string
 *                 minLength: 10
 *               foto:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Post created successfully
 *       400:
 *         description: Validation error or no file uploaded
 *       401:
 *         description: Unauthorized
 */
app.post('/posts', isAuth, upload.single('foto'), async (req, res) => {
    let { title, content } = req.body;
    console.log(req.file);
    console.log(req.body);

    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    // cleanup title and content
    title = title ? title.trim() : null;
    content = content ? content.trim() : null;

    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }

    req.file.filename = req.file.filename + "." + req.file.originalname.split('.').pop();
    const result = await uploadFile(req.file);
    console.log({ msg: "resultado do upload", result });

    await prisma.post.create({
        data: {
            imageId: req.file.filename,
            authorId: req.user.id,
            title,
            content,
        },
    });

    res.status(201).send();
});

/**
 * @swagger
 * /posts/{id}:
 *   delete:
 *     summary: Delete a post
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Post ID
 *     responses:
 *       200:
 *         description: Post deleted successfully
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Post not found
 */
app.delete('/posts/:id', isAuth, async (req, res) => {
    const { id } = req.params;
    const post = await prisma.post.findUnique({
        where: {
            id: parseInt(id),
        },
    });

    if (!post) {
        return res.status(404).json({ error: 'Post not found' });
    }

    if (post.authorId !== req.user.id) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    await prisma.post.delete({
        where: {
            id: parseInt(id),
        },
    });

    res.send('OK');
});

/**
 * @swagger
 * /users/{id}:
 *   get:
 *     summary: Get user by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: User ID
 *     responses:
 *       200:
 *         description: User details
 *       404:
 *         description: User not found
 */
app.get('/users/:id', async (req, res) => {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
        where: {
            id: parseInt(id),
        },
        include: {
            posts: true,
        },
    });
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
});

app.use((req, res, next) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000, () => console.log("Server iniciou na porta 3000"));
