const AdmZip = require('adm-zip');
const yaml = require('js-yaml');
require('dotenv').config();
const axios = require('axios');
const cliProgress = require('cli-progress');

const ADA_BASE_URL = `https://${process.env.ADA_HANDLE}.ada.support/api/knowledge/v1`;
const API_KEY = process.env.ADA_API_KEY;

// Function to extract and process markdown files from a zip
async function processMarkdownFiles() {
    const zip = new AdmZip("./Docs.zip");
    const markdownFiles = zip.getEntries().filter(entry => entry.entryName.endsWith('.md'));
    const documents = [];

    markdownFiles.forEach(entry => {
        try {
            const content = entry.getData().toString('utf8');
            const yamlContentRegex = /---\n([\s\S]*?)\n---(published|draft)/;
            const match = content.match(yamlContentRegex);

            if (match) {
                const yamlContent = match[1];
                const metadata = yaml.load(yamlContent);

                if (metadata.type === "page") {
                    // Determine the correct split based on the matched terminator
                    const terminator = match[2];
                    const markdown = content.split(`---${terminator}`)[1].trim();
                    documents.push({ metadata, markdown });
                }
            }
        } catch (error) {
            console.error(`Error processing file ${entry.entryName}:`, error.message);
        }
    });

    return documents;
}

async function manageKnowledgeSources() {
    const headers = {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // Get all knowledge sources
        const sourcesResponse = await axios.get(`${ADA_BASE_URL}/sources`, { headers });
        const sourcesData = sourcesResponse.data;

        const sources = sourcesData.data || [];
        let opswatSource = sources.find(source => source.name === "opswat docs import");

        // Delete the "opswat docs import" source if it exists
        if (opswatSource) {
            await axios.delete(`${ADA_BASE_URL}/sources/${opswatSource.id}`, { headers });
        }

        // Create a new "opswat docs import" source
        const createResponse = await axios.post(`${ADA_BASE_URL}/sources`, {
            name: "opswat docs import"
        }, { headers });

        const newSourceId = createResponse.data.data.id;
        return newSourceId;
    } catch (error) {
        console.error('Error managing knowledge sources:', error.message);
        throw error;
    }
}

async function uploadArticles(articles) {
    const headers = {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
    };

    const reqBody = {
        articles: [articles]
    };

    try {
        const response = await axios.post(`${ADA_BASE_URL}/articles`, reqBody, { headers });
        return response.data;
    } catch (error) {
        console.error('Error uploading articles:', error.message);
        throw error;
    }
}

let currentArticle;

// Execute the function and output results, then manage knowledge sources
async function main() {
    let documents, sourceId;
    try {
        documents = await processMarkdownFiles();
        console.log(`Processed ${documents.length} documents.`);
        
        sourceId = await manageKnowledgeSources();
        console.log(`Operation completed. New source ID: ${sourceId}`);
    } catch (error) {
        console.error("Error during initial processing:", error);
        return;
    }

    const articles = documents.map(doc => ({
        id: doc.metadata.slug,
        name: doc.metadata.title,
        content: doc.markdown,
        knowledge_source_id: sourceId 
    })); 

    // Create a new progress bar instance and use shades_classic style
    const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    progressBar.start(articles.length, 0);        

    for (const [index, article] of articles.entries()) {
        currentArticle = article;
        try {
            await uploadArticles(article);
        } catch (error) {
            console.error(`Error uploading article ${article.id}:`, error);
        }
        progressBar.update(index + 1);
        await new Promise(resolve => setTimeout(resolve, 50));
    }

    progressBar.stop();
}

main();
