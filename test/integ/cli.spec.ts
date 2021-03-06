import { expect } from "chai"
import { spawnSync, spawn, execSync } from "child_process"
import fs = require("fs-extra")
const CONFIG_FILENAME = ".approved-licenses.yml"
import escapes = require("ansi-escapes")

// This should not only be the current config checked into git, but also
// an example of valid config file.
const expectedCurrentConfigFile = [
  "licenses:",
  "  - ISC",
  "  - MIT",
  "  - BSD-2-Clause",
  "  - BSD-3-Clause",
  "  - Apache-2.0",
  "  - CC-BY-3.0",
  "  - CC0-1.0",
  "modules: []",
  ""
].join("\n")

// contains at least one invalid module that will be interactively approved
// in a test.
const invalidModuleConfig = [
  "licenses:",
  "  - ISC",
  "  - MIT",
  "  - BSD-2-Clause",
  "  - BSD-3-Clause",
  "  - Apache-2.0",
  "  - CC-BY-3.0",
  "  - (MIT OR CC0-1.0)",
  "  - (MIT AND CC-BY-3.0)",
  "modules: []",
  ""
].join("\n")

const invalidLicensesConfig = [
  "licenses:",
  "  - ISC",
  "  - MIT",
  "  - BSD-2-Clause",
  "  - BSD-3-Clause",
  "  - Apache-2.0",
  "modules: []",
  ""
].join("\n")

function yes(cp) {
  cp.stdin.write(`${escapes.cursorDown()}\n`)
}

function saveAndQuit(cp) {
  cp.stdin.write(`${escapes.cursorDown()}`)
  cp.stdin.write(`${escapes.cursorDown()}\n`)
}

function no(cp) {
  cp.stdin.write(`\n`)
}

function isAllowLicensePrompt(buffer) {
  return !!// caste to boolean
  buffer
    .toString("utf8")
    .replace(/\n/g, "") // new lines cause problems
    .match(/.*Would you like to allow this license\?.*\(Use arrow keys\)/m) // only works if initial prompt is unique
}

function isModifyModulesPrompt(buffer) {
  return !!// caste to boolean
  buffer
    .toString("utf8")
    .replace(/\n/g, "") // new lines cause problems
    .match(
      /.*Would you like to modify your approved module list\?.*\(Use arrow keys\)/m
    ) // only works if initial prompt is unique
}

function isAllowModulePrompt(buffer) {
  return !!// caste to boolean
  buffer
    .toString("utf8")
    .replace(/\n/g, "") // new lines cause problems
    .match(
      /.*Would you like to allow this module anyway\?.*\(Use arrow keys\)/m
    ) // only works if initial prompt is unique
}

// Allows the integration test to run on this repo's package.json and installed modules.
async function stash(fileContents = null) {
  await fs.remove("./tmp")
  await fs.ensureDir("./tmp")
  await fs.copy(`${CONFIG_FILENAME}`, `tmp/${CONFIG_FILENAME}`)

  if (fileContents === null) {
    await fs.writeFile(CONFIG_FILENAME, fileContents)
  }
}
async function restore() {
  await fs.copy(`tmp/${CONFIG_FILENAME}`, `${CONFIG_FILENAME}`)
}

//
// Tests
// Since many of these spawn processes and do I/O most need large timeouts.
//

describe("integration test: validates current repo is in a valid state", () => {
  before(async () => {
    await stash(expectedCurrentConfigFile)
  })

  after(async () => {
    await restore()
  })

  it("should have valid config file", async () => {
    // Tests current state
    const fileExists = await fs.pathExists("./.approved-licenses.yml")
    expect(fileExists).to.be.true

    const expectedResult =
      "Based on your .approved-licenses.yml config file, all your dependencies' licenses are valid.\n"
    let stdout = execSync(`ts-node ./src/index.ts`)
    expect(stdout.toString("utf-8")).to.equal(expectedResult)
  }).timeout(20000)

  it("should print summary", async () => {
    const expectedResult = [
      `Licenses`,
      "",
      "APPROVED:",
      "├─ ISC: 23",
      "├─ MIT: 58",
      "├─ BSD-2-Clause: 2",
      "├─ BSD-3-Clause: 2",
      "├─ Apache-2.0: 4",
      "├─ CC-BY-3.0: 1",
      "├─ CC0-1.0: 1",
      "├─ (MIT AND CC-BY-3.0): 1",
      "└─ (MIT OR CC0-1.0): 1",
      "",
      "UNAPPROVED:",
      "  None",
      "",
      "UNPROCESSED:",
      "  None",
      "",
      ""
    ].join("\n")
    let { stdout } = spawnSync("ts-node", ["./src/index.ts", "--summary"], {})
    expect(stdout.toString("utf8")).to.equal(expectedResult)
  }).timeout(20000)
})

describe("integration test: validates bad files are cleanly handled", () => {
  before(async () => {
    await stash()
  })

  after(async () => {
    await restore()
  })

  it("should warn when approved list is empty", async () => {
    await fs.writeFile(CONFIG_FILENAME, "licenses: []\nmodules: []\n")
    let { stdout } = spawnSync("ts-node", ["./src/index.ts", "--summary"], {})
    expect(stdout).to.match(
      /Approved license list is empty. Run with option -i to generate a config file./
    )
  }).timeout(20000)

  it("should error on bad files", async () => {
    // No file
    await fs.remove(CONFIG_FILENAME)
    const { stdout: noFileResult } = spawnSync(
      "ts-node",
      ["./src/index.ts"],
      {}
    )
    expect(noFileResult.toString("utf-8")).to.equal(
      "Config file .approved-licenses.yml not found. Run with option -i to generate a config file.\n"
    )

    // empty config file
    await fs.writeFile(
      CONFIG_FILENAME,
      [`licenses: []`, `modules: []`].join("\n")
    )
    const { stdout: emptyConfigResult } = spawnSync(
      "ts-node",
      ["./src/index.ts"],
      {}
    )
    expect(emptyConfigResult.toString("utf-8")).to.match(/APPROVED:\n\s+None/)
  }).timeout(20000)

  it("should error on invalid yml", async () => {
    await fs.writeFile(CONFIG_FILENAME, "")
    const { stdout, stderr } = spawnSync("ts-node", ["./src/index.ts"], {})
    expect(stdout.toString("utf-8")).to.equal("")
    expect(stderr.toString("utf-8")).to.equal(
      "Configuration file found but it is empty.\n"
    )
  }).timeout(20000)
})

describe("integration tests: validates interactive mode", () => {
  before(async () => {
    await stash()
  })

  after(async () => {
    await restore()
  })

  it("should be able to save and quit", done => {
    // Write a file that should be missing 2 licenses
    fs.writeFileSync(CONFIG_FILENAME, invalidLicensesConfig)
    const cp = spawn("ts-node", ["./src/index.ts", "-i"])
    let promptCount = 0
    cp.stdout.on("data", data => {
      if (isAllowLicensePrompt(data)) {
        promptCount++
        // First license, approve
        if (promptCount === 1) {
          yes(cp)
        }
        // Second license, save/quit
        if (promptCount === 2) {
          saveAndQuit(cp)
        }
      }
      if (isModifyModulesPrompt(data)) {
        no(cp)
      }
    })
    cp.on("error", err => {
      console.log(err)
      expect.fail()
      done(err)
    })
    cp.on("close", () => {
      fs.readFile(CONFIG_FILENAME, "utf8")
        .then(data => {
          expect(data).to.equal(
            [
              "licenses:",
              "  - ISC",
              "  - MIT",
              "  - BSD-2-Clause",
              "  - BSD-3-Clause",
              "  - Apache-2.0",
              "  - CC-BY-3.0", // approved
              // '  - CC0-1.0',// save/quit before any action taken
              "modules: []",
              ""
            ].join("\n")
          )
          done()
        })
        .catch(err => {
          console.log(err)
          done(err)
        })
    })
  }).timeout(30000)

  it("should be able to approve all licenses", done => {
    fs.removeSync(CONFIG_FILENAME)
    const cp = spawn("ts-node", ["./src/index.ts", "-i"])
    cp.stdout.on("data", data => {
      if (isAllowLicensePrompt(data)) {
        yes(cp)
      }
    })
    cp.on("error", err => {
      console.log(err)
      expect.fail()
    })
    cp.on("close", () => {
      fs.readFile(CONFIG_FILENAME, "utf8")
        .then(data => {
          expect(data).to.equal(
            [
              "licenses:",
              "  - ISC",
              "  - MIT",
              "  - BSD-2-Clause",
              "  - BSD-3-Clause",
              "  - Apache-2.0",
              "  - CC-BY-3.0",
              "  - CC0-1.0",
              "  - (MIT AND CC-BY-3.0)",
              "  - (MIT OR CC0-1.0)",
              "modules: []",
              ""
            ].join("\n")
          )
          done()
        })
        .catch(err => {
          console.log(err)
          done(err)
        })
    })
  }).timeout(20000)

  it("should validate by module", done => {
    fs.writeFileSync(CONFIG_FILENAME, invalidModuleConfig)
    const cp = spawn("ts-node", ["./src/index.ts", "-i", "-m"])
    cp.stdout.on("data", data => {
      if (isModifyModulesPrompt(data)) {
        yes(cp)
        return
      }
      if (isAllowModulePrompt(data)) {
        yes(cp)
        return
      }
    })
    cp.on("error", err => {
      expect.fail()
    })
    cp.on("close", () => {
      fs.readFile(CONFIG_FILENAME, "utf8")
        .then(data => {
          expect(data).to.equal(
            [
              "licenses:",
              "  - ISC",
              "  - MIT",
              "  - BSD-2-Clause",
              "  - BSD-3-Clause",
              "  - Apache-2.0",
              "  - CC-BY-3.0",
              "  - (MIT OR CC0-1.0)",
              "  - (MIT AND CC-BY-3.0)",
              "modules:",
              "  - spdx-license-ids@3.0.3",
              ""
            ].join("\n")
          )
          done()
        })
        .catch(done)
    })
  }).timeout(20000)
})
