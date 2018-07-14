/**
 * Parse and convert .sqkr files to json
 */

/**
 * Invoke the parser with lines of input
 * @param {string} text valid squeaker text
 * @returns {Iterator<{utterance: string, facts: string[]}>} intermediate form of squeaker parsing still plaintext
 */
function* parseInput(text) {
    const lines = text.split(/\r?\n/);
    const parser = parse();
    parser.next();

    for (const mline of lines) {
        const line = mline.toLowerCase();
        const { value: utterance } = parser.next(line);
        if (utterance) {
            parser.next(line);
            yield utterance;
        };
    }
    const { value } = parser.return();
    if (value.utterance) yield value;
}

const matchFact = /^\s*-\s*(.*)$/;
const matchBlank = /^\s*$/;
/**
 * Parse utterances in squeaker text
 * @returns {Iterator<{utterance: string, facts: string[]} | void>} intermediate form of squeaker parsing still plaintext
 */
function* parse() {
    let next;
    let error = null;
    try {
        for (; ;) {
            next = { player: "", utterance: "", facts: [] };
            let input, fact;
            // Player mode
            input = yield;
            const playerNameMatch = /\s*(.*)\s*:/.exec(input);
            if (!playerNameMatch) throw new Error("Invalid player name");
            next.player = playerNameMatch[1];

            // Utterance mode
            for (; ;) {
                input = yield;
                fact = input.match(matchFact);
                if (fact !== null) {
                    next.utterance = next.utterance.replace(/\s+/g, " ");
                    break;
                };
                next.utterance += input;
            }
            // Facts Mode
            facts: {
                for (; ;) {
                    // A single fact
                    const factA = [];
                    next.facts.push(factA);
                    for (; ;) {
                        factA.push(...getCommands(fact[1]));

                        input = yield;
                        if (matchBlank.exec(input)) break facts;
                        fact = input.match(matchFact);
                        if (fact !== null) break;
                        fact = [, input];
                    }
                }
            }
            const result = next;
            next = null;
            yield result;
        }
    } catch (e) {
        error = e;
    } finally {
        if (error) throw error;
        return next;
    }
}

/**
 * Extract the commands from a fact in squeaker or return null if line is not a fact
 * @param {string} line a single fact, can be on multiple lines
 * @return {IterableIterator<{pred: string, id: string, arg: string}> | null}
 */
function* getCommands(line) {
    const extractCmd = /\s*(?<pred>[^\(\[]*)\s*(\[(?<id>[^\]]*)\])?\s*(\((?<arg>[^\)]*)\))?/g;
    let match = extractCmd.exec(line);
    while (match.groups.pred) {
        const { pred, id, arg } = match.groups;
        yield { pred, id, arg };
        match = extractCmd.exec(line);
    }
}

const temp = Symbol("Temporary data used in stub");

/**
 * Process the intermediate repr from the parser and resolve commands
 * @param {Iterable} sqkr returned from parser
 */
function resolveCommands(sqkr) {
    const utteranceStubs = [];
    for (const { player, utterance, facts } of sqkr) {
        const stub = { player, utterance: null, [temp]: { original: utterance, fragments: [] }, facts: [] };
        utteranceStubs.push(stub);
        for (const fact of facts) {
            const factStub = { [temp]: {} };
            for (const { pred, id, arg } of fact) {
                command.call(factStub, stub, utteranceStubs, { pred, id, arg });
            }
            stub.facts.push(factStub);
        }
    }
    const resolution = resolveStubs(utteranceStubs);
    return resolution;
}

// https://github.com/d3/d3-array#ascending
function sortAscending(access = x => x) {
    return (a, b) => {
        a = access(a);
        b = access(b);
        return a < b ? -1 : a > b ? 1 : a >= b ? 0 : NaN;
    }
}

function* pairs(iter) {
    const arr = [...iter];
    if (arr.length < 2) {
        return;
    }
    if (arr.length == 2) {
        yield [arr[0], arr[1]];
        return;
    }
    for (let i = 1; i < arr.length; i++) {
        yield [arr[i - 1], arr[i]];
    }
}

/**
 * Change the ranges in the indices so that none overlap
 * @param {*} arr 
 */
function modifyStartEndIndices(arr) {
    const breaks = [].concat(...arr);
    breaks.sort(sortAscending());
    return Array.from(pairs(unique(breaks)));
}

/**
 * Find gaps in the indexes
 */
function* fillGaps(utteranceLength, arr) {
    yield arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i][0] > arr[i - 1][1]) {
            yield [arr[i - 1][1], arr[i][0]];
        }
        yield arr[i];
    }
    if (arr[arr.length - 1][1] < utteranceLength) {
        yield [arr[arr.length - 1][1], utteranceLength];
    }
}

function resolveStubs(stubs) {
    for (const stub of stubs) {
        const utterance = stub[temp].original;
        const fragments = [...new Set([[0, 0], ...stub[temp].fragments, [utterance.length, utterance.length]])];

        fragments.sort(sortAscending(o => o[0]));
        const chunks = [];
        const gaps = [...fillGaps(utterance.length, modifyStartEndIndices(fragments))];
        for (const [start, end] of gaps) {
            chunks.push(utterance.substring(start, end));
        }
        stub.utterance = chunks.map(chunk => chunk.trim());
        for (const fact of stub.facts) {
            const proofIndices = fact[temp].proof;
            fact.proof = Array.from(new Set([].concat(...proofIndices.map(([start, end]) => {
                const chunksIndices = [];
                let charIndex = 0;
                for (const [chunkIndex, chunk] of enumerate(chunks)) {
                    const chunkStart = charIndex,
                        chunkEnd = charIndex + chunk.length;
                    if (chunkStart >= start && chunkEnd <= end) {
                        chunksIndices.push(chunkIndex);
                    };
                    charIndex += chunk.length;
                }
                return chunksIndices;
            }))));
            fact.proof.sort(sortAscending());
        }
    }
    return stubs;
}

/**
 * Iterate an array backwards
 * @template T
 * @param {Iterable<T>} iterable to iterate
 * @returns {IterableIterator<T>}
 */
function* rev(iterable) {
    const arr = [...iterable];
    for (let i = arr.length - 1; i >= 0; i--) {
        yield arr[i];
    }
}

/**
 * Iterate an iterable with it's indices
 * @param {Iterable<T>} iterable to iterate
 * @returns {IterableIterator<[number, T]>}
 */
function* enumerate(iterable, start = 0) {
    let i = start;
    for (const item of iterable) {
        yield [i++, item];
    }
}

/**
 * Iterate unique items based on accessor
 */
function* unique(items, access = x => x) {
    const old = new Set;
    for (const item of items) {
        const key = access(item);
        if (old.has(key)) continue;
        yield item;
        old.add(key);
    }
}

/**
 * Split a quote on elipsis
 * @param {string} quote
 * @returns {string[]} the split quote
 */
function splitQuote(quote) {
    return quote.split(/\s*\.{3}\s*/);
}

/**
 * Get the indexes that the quote fragments the untterance at
 * @param {string} utterance 
 * @param {string[]} quote 
 * @returns {number[] | null} null if quote does not match
 */
function getUtteranceFragments(utterance, quote) {
    const fragments = [];
    let offset = 0;
    for (const part of quote) {
        const index = utterance.indexOf(part);
        if (index === -1) return null;
        const start = index + offset;
        let end = start + part.length;
        if (end < utterance.length && utterance[end].match(/\s/)) {
            end += 1;
        }
        fragments.push([start, end]);
        utterance = utterance.substr(index + part.length);
        offset += index + part.length;
    }
    return fragments;
}

/**
 * Find the quote referenced and return it
 * Modify the utteranceStub so that it contains the correct fragments
 * @param {*} utteranceStubs 
 * @param {string} quote 
 */
function matchQuote(utteranceStubs, quote) {
    quote = splitQuote(quote);
    for (const utterance of rev(utteranceStubs)) {
        let fragments = getUtteranceFragments(utterance[temp].original, quote);
        if (!fragments) continue;
        utterance[temp].fragments.push(...fragments);
        return fragments;
    }
    throw new Error(`Failed to find quote, "${quote}"`);
}

/**
 * Return the lookup identifier that matches the id
 */
function lookupID(utteranceStubs, id) {
    for (const [utteranceIndex, { facts }] of rev(enumerate(utteranceStubs))) {
        for (const [factIndex, fact] of rev(enumerate(facts))) {
            if (fact[temp].id === id) {
                return {
                    utterance: utteranceIndex,
                    fact: factIndex,
                };
            }
        }
    }
    throw new Error(`Id lookup of id: "${id}" failed`);
}

const commands = {
    claim(stub, stubs, { id, arg }) {
        if (!arg) throw new Error(`Quote requires an argument`);
        this.claim = arg;
        this[temp].id = id;
    },
    quote(stub, stubs, { id, arg }) {
        if (id) throw new Error(`Quote should not have an id. id: ${id}`);
        if (!arg) throw new Error(`Quote requires an argument`);
        const fragments = matchQuote(stubs, arg);
        this[temp].proof = fragments;
    },
    summary(stub, stubs, { id, arg }) {
        if (id) throw new Error(`Adding id "${id}" to summary "${arg}" has no affect`);
        if (!arg) throw new Error(`Summary requires an argument`);
        this.summary = arg;
    },
    redacts(stub, stubs, { id, arg }) {
        if (!id) throw new Error(`Redacts requires an id`);
        if (arg) throw new Error(`Redacts should not have an argument. argument: "${arg}"`);
        const ID = lookupID(stubs, id);
        if (!this.redacts) this.redacts = [];
        this.redacts.push(ID);
    },
    inspiration(stub, stubs, { id, arg }) {
        if (!id) throw new Error(`Inspiration requires an id`);
        if (arg) throw new Error(`Inspiration should not have an argument. argument: "${arg}"`);
        const ID = lookupID(stubs, id);
        if (!this.inspiration) this.inspiration = [];
        this.inspiration.push(ID);
    },
    __proto__: null,
};

function command(stub, stubs, { pred, id, arg }) {
    if (!(pred in commands)) {
        throw new Error(`Unknown predicate "${pred}"`);
    }
    commands[pred].call(this, stub, stubs, { id, arg });
}

process.stdin.setEncoding('utf8');
let input = "";
process.stdin.on('readable', () => {
    input += process.stdin.read() || "";
});
process.stdin.on('end', () => {
    const result = resolveCommands(parseInput(input));
    process.stdout.write(JSON.stringify(result));
});
