const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ANSI Escape Codes for Premium UI Aesthetics
const cyan = '\x1b[36m';
const red = '\x1b[31m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const gold = '\x1b[38;2;212;175;55m'; // Gold color to match SecuLex theme
const reset = '\x1b[0m';
const bold = '\x1b[1m';

const postsDir = path.join(__dirname, '..', 'src', 'posts');

// Helper function to extract title and date from front matter without external yaml dependency
function parseArticleDetails(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        
        let title = '';
        let date = '';
        
        if (match) {
            const fmText = match[1];
            const lines = fmText.split('\n');
            for (let line of lines) {
                line = line.trim();
                // Simple parsing for title and date keys
                if (line.toLowerCase().startsWith('title:')) {
                    title = line.substring(6).trim().replace(/^['"]|['"]$/g, '');
                } else if (line.toLowerCase().startsWith('date:')) {
                    date = line.substring(5).trim().replace(/^['"]|['"]$/g, '');
                }
            }
        }
        
        return {
            title: title || path.basename(filePath),
            date: date ? new Date(date).toLocaleDateString() : 'Unknown Date',
            fileName: path.basename(filePath)
        };
    } catch (err) {
        return {
            title: path.basename(filePath),
            date: 'Error reading file',
            fileName: path.basename(filePath)
        };
    }
}

function main() {
    console.log(`\n${bold}${gold}=== SecuLex Article Deletion Tool ===${reset}\n`);

    if (!fs.existsSync(postsDir)) {
        console.error(`${red}Error: Posts directory not found at: ${postsDir}${reset}`);
        process.exit(1);
    }

    // Get all markdown files in posts directory
    const files = fs.readdirSync(postsDir)
        .filter(file => file.endsWith('.md'))
        .map(file => {
            const filePath = path.join(postsDir, file);
            return {
                filePath,
                ...parseArticleDetails(filePath)
            };
        });

    if (files.length === 0) {
        console.log(`${yellow}No articles found in ${postsDir}.${reset}`);
        process.exit(0);
    }

    // Display articles to user
    console.log(`${cyan}Available Articles:${reset}`);
    files.forEach((file, index) => {
        console.log(`  ${bold}[${index + 1}]${reset} ${file.title} ${cyan}(Published: ${file.date})${reset}`);
        console.log(`      File: ${file.fileName}`);
    });
    console.log('');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    // Ask user to select an article
    rl.question(`${bold}Enter the number of the article to delete (or press Enter to cancel): ${reset}`, (answer) => {
        const choice = answer.trim();
        
        if (!choice) {
            console.log(`\n${yellow}Operation cancelled.${reset}`);
            rl.close();
            process.exit(0);
        }

        const selectedIndex = parseInt(choice, 10) - 1;

        if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= files.length) {
            console.log(`\n${red}Invalid selection. Operation cancelled.${reset}`);
            rl.close();
            process.exit(1);
        }

        const selectedArticle = files[selectedIndex];

        console.log(`\n${red}${bold}⚠️  WARNING:${reset} You are about to permanently delete:`);
        console.log(`   Title: ${bold}${selectedArticle.title}${reset}`);
        console.log(`   File:  ${selectedArticle.filePath}\n`);

        // Ask for final confirmation
        rl.question(`${bold}Are you absolutely sure you want to delete this article? (type 'yes' to confirm): ${reset}`, (confirm) => {
            if (confirm.trim().toLowerCase() === 'yes') {
                try {
                    fs.unlinkSync(selectedArticle.filePath);
                    console.log(`\n${green}✓ Success: Article file deleted successfully.${reset}`);
                    console.log(`${cyan}Note: Run 'npm run build' to regenerate your blog site without this article.${reset}\n`);
                    rl.close();
                    process.exit(0);
                } catch (err) {
                    console.error(`\n${red}Error deleting file: ${err.message}${reset}`);
                    rl.close();
                    process.exit(1);
                }
            } else {
                console.log(`\n${yellow}Confirmation failed. Operation cancelled.${reset}\n`);
                rl.close();
                process.exit(0);
            }
        });
    });
}

main();
