const express = require('express');
const app = express();
const port = 3010;

const multer  = require('multer');
const upload = multer({ dest: 'uploads/' });

const fetch = require('node-fetch');

const { spawn } = require('child_process');

// Run a Python script and return output
async function runPythonScript(scriptPath, args, res) {

  // Use child_process.spawn method from 
  // child_process module and assign it to variable
  const pyProg = spawn('python', [scriptPath].concat(args));

  // Collect data from script and print to console
  let data = '';
  pyProg.stdout.on('data', (stdout) => {
    data += stdout.toString();
  });

  // Print errors to console, if any
  pyProg.stderr.on('data', (stderr) => {
    //console.log(`stderr: ${stderr}`);
  });

  let flag = false;

  // When script is finished, print collected data
  pyProg.on('close', (code) => {
    //console.log(`child process exited with code ${code}`);
    //console.log(data);
    data.slice(2, -3).split(', b').forEach(str => {
        addTwoObj(res, Object.fromEntries([[Buffer.from(str.slice(1, -1).split(':')[0].split('\\x').slice(1).map(strInt => {
            return Number.parseInt(strInt, 16);
        })).toString('utf-8'), +str.slice(1, -1).split(':')[1]]]));
    });
    flag = true;
  });
  await waitFor(() => flag);
}

// Polls every 50 milliseconds for a given condition
const waitFor = async (condition, pollInterval = 50, timeoutAfter) => {
    // Track the start time for timeout purposes
    const startTime = Date.now();
  
    while (true) {
      // Check for timeout, bail if too much time passed
      if(typeof(timeoutAfter) === 'number' && Date.now() > startTime + timeoutAfter) {
        throw 'Condition not met before timeout';
      }
  
      // Check for conditon immediately
      const result = await condition();
  
      // If the condition is met...
      if(result) {
        // Return the result....
        return result;
      }
  
      // Otherwise wait and check after pollInterval
      await new Promise(r => setTimeout(r, pollInterval));
    }
};

function addTwoObj(first, second) {
    for (let key in second) {
        if (!first[key]) {
            first[key] = second[key];
            continue;
        }
        first[key] += second[key];
    }
}

async function checkAllTexts(entries) {
    let count = Math.ceil(entries.length / 100);
    const result = [];
    for (let i = 0; i < count * 100; i += 100) {
        const add = await checkTexts(entries.map(stat => {
            return "text=" + stat[0];
        }).slice(i, i + 100).join('&'));
        result.push(...add);
    }
    const result2 = result.filter(item => item.length).map(item => item[0].word);
    return result2;
}

async function checkTexts(entries) {
    const wrongRes = await fetch("https://speller.yandex.net/services/spellservice.json/checkTexts?" + entries);
    return await wrongRes.json();
}

function getFile(filename) {
    const fs = require('node:fs');
    const data = fs.readFileSync(__dirname + '/uploads/' + filename).toString();
    fs.unlinkSync(__dirname + '/uploads/' + filename);
    return data;
}

function getRusWords(data) {
    return data.replace(/[^А-Яа-я\s]/g, '').split(/\s+/).map(word => word.toLowerCase());
}

function getRusWordsFromMsgs(data, nick) {
    const msgs = data.messages.filter(msg => msg.forwarded_from === undefined && msg.from === nick).map(msg => {
        return msg.text;
    }).filter(text => typeof text === 'string' && text.length);
    const rusWordsMsgs = msgs.map(msg => msg.replace(/[^А-Яа-я\s]/g, '').split(/\s+/)
        .map(word => word.toLowerCase()));
    const rusWords = [];
    for (let rusWordsMsg of rusWordsMsgs) {
        rusWords.push(...rusWordsMsg);
    }
    return rusWords;
}

function getStats(words) {
    const stats = {};
    for (let word of words) {
        if (word === "") continue;
        stats[word] = stats[word] ? stats[word] + 1 : 1;
    }
    return stats;
}

async function lemmatize(stats) {
    const lemmas = {};
    const lemmasEntries = Object.entries(stats);
    let count = Math.ceil(lemmasEntries.length / 100);
    for (let i = 0; i < count * 100; i += 100) {
        await runPythonScript('C:/Users/oleg1/Documents/word-stats/script.py', lemmasEntries.slice(i, i + 100).map(entry => entry.join(':')).toString(), lemmas);
    }
    return lemmas;
}

function getMetricsStats(words, num) {
    const metricsRusWords = words.slice(-num);
    const metricsStats = {};
    for (let word of metricsRusWords) {
        if (word === "") continue;
        metricsStats[word] = metricsStats[word] ? metricsStats[word] + 1 : 1;
    }
    return Object.entries(metricsStats);
}

function getSortedStrStats(stats) {
    const sortedStats = Object.entries(stats).sort((a, b) => b[1] - a[1]);
    const sortedStrStats = sortedStats.map((stat) => stat[0] + ": " + stat[1]).join("<br />");
    return sortedStrStats;
}

function filterFromWrong(metricsStats, wrong) {
    for (let i = 0; i < metricsStats.length; i++) {
        if (wrong.includes(metricsStats[i][0])) {
            metricsStats.splice(i, 1);
        }
    }
}

app.get('/', (req, res) => {
    res.sendFile(__dirname + "/count_words.html");
});

app.get('/hidden', (req, res) => {
    res.sendFile(__dirname + "/count_words_hidden.html");
});

app.post('/stats', upload.array('file', 12), async (req, res) => {
    const data = getFile(req.files[0].filename);
    const rusWords = getRusWords(data);
    const stats = getStats(rusWords);

    const lemmas = await lemmatize(stats);

    const NUM = 50_000;
    const metricsStats = getMetricsStats(rusWords, NUM);

    const sortedStrStats = getSortedStrStats(lemmas);
    res.send("СЛОВОРАЗНООБРАЗИЕ - " + (metricsStats.length / NUM) + "<br />" +
        "СЛОВ ВСЕГО - " + rusWords.length + "<br />" + sortedStrStats);
});

app.post('/stats_from_tg', upload.array('file', 12), async (req, res) => {
    const data = JSON.parse(getFile(req.files[0].filename));
    const rusWords = getRusWordsFromMsgs(data, req.body.from);
    const stats = getStats(rusWords);
    
    const NUM = 50_000;
    const metricsStats = getMetricsStats(rusWords, NUM);

    let wrong = await checkAllTexts(metricsStats);
    console.log(wrong);

    filterFromWrong(metricsStats, wrong);
    const sortedStrStats = getSortedStrStats(stats);
    res.send("СЛОВОРАЗНООБРАЗИЕ - " + (metricsStats.length / NUM) + "<br />" +
        "СЛОВ ВСЕГО - " + rusWords.length + "<br />" + sortedStrStats);
});

app.post('/stats_present', upload.none(), async (req, res) => {
    const data = req.body.text;
    const rusWords = getRusWords(data);
    const stats = getStats(rusWords);

    const lemmas = Boolean(req.body.lemma) ? await lemmatize(stats) : stats;

    const NUM = +req.body.number;
    const metricsStats = getMetricsStats(rusWords, NUM);

    if (Boolean(req.body.mistakeIndex)) {
        let wrong = await checkAllTexts(metricsStats);
        console.log(wrong);

        filterFromWrong(metricsStats, wrong);
    }

    const metricsLemmaStats = Boolean(req.body.lemmaIndex) ? Object.entries(await lemmatize(Object.fromEntries(metricsStats))) : metricsStats;

    const sortedStrStats = getSortedStrStats(lemmas);
    res.send("СЛОВОРАЗНООБРАЗИЕ - " + (metricsLemmaStats.length / NUM) + "<br />" +
        "СЛОВ ВСЕГО - " + rusWords.length + "<br />" + sortedStrStats);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});