import { expect } from "chai"
const { stringify } = JSON
const rewire = require("rewire")
const { EventEmitter } = require("events")

describe("#loadConfig", () => {
  const checker = rewire("../src/checker.ts")

  it("should load and validate a config file", async () => {
    // Test an empty file.
    let readFile = async () => {
      return ``
    }
    checker.__set__("fs", {
      readFile
    })
    try {
      await checker.loadConfig("./a/valid/filePath")
      expect.fail("Should throw validation error")
    } catch (e) {
      expect(e.message).to.equal("Configuration file found but it is empty.")
    }

    // Test if it is missing modules
    readFile = async () => {
      return `licenses:\n  - MIT`
    }
    checker.__set__("fs", {
      readFile
    })
    try {
      await checker.loadConfig("./a/valid/filePath")
      expect.fail("Should throw validation error")
    } catch (e) {
      expect(e.message).to.equal(
        `Configuration file found but it does not have the expected root level 'modules' array.`
      )
    }

    // Test if it is missing licenses
    readFile = async () => {
      return `modules: []`
    }
    checker.__set__("fs", {
      readFile
    })
    try {
      await checker.loadConfig("./a/valid/filePath")
      expect.fail("Should throw validation error")
    } catch (e) {
      expect(e.message).to.equal(
        `Configuration file found but it does not have the expected root level 'licenses' array.`
      )
    }

    // Test if it is missing licenses
    readFile = async () => {
      return `modules: []\nlicenses: []\n`
    }
    checker.__set__("fs", {
      readFile
    })
    const expectedApprovedLicenses = {
      licenses: [],
      modules: []
    }
    expect(await checker.loadConfig("./a/valid/filePath")).to.eql(
      expectedApprovedLicenses
    )
  })
})

describe("#getAndValidateConfig", () => {
  it("should load an existing config or return new baseline config", async () => {
    const checker = rewire("../src/checker.ts")
    // Test when file does not exist
    checker.__set__("fs", {
      pathExists: async () => false
    })
    let result = await checker.getAndValidateConfig("./path/to/.config")
    expect(result).to.eql({
      licenses: [],
      modules: []
    })

    // Test when file exists
    checker.__set__("fs", {
      pathExists: async () => true,
      readFile: async () => `licenses:\n  - MIT\nmodules: []\n`
    })
    // 'this' is broken when we rewire()
    checker.__set__("loadConfig", checker.loadConfig)
    result = await checker.getAndValidateConfig("./path/to/.config")
    expect(result).to.eql({
      licenses: ["MIT"],
      modules: []
    })
  })
})

describe("#getDepTree", () => {
  it("should return json dependency tree", async () => {
    let checker = rewire("../src/checker.ts")
    let stdout = stringify({
      name: "arrsome-module",
      dependencies: {
        "a-dep": {
          from: "a-dep@1.0.0"
        }
      }
    })
    let stdoutStream = new EventEmitter()
    let cp = new EventEmitter()
    let exec = function() {
      cp.stdout = stdoutStream
      return cp
    }
    let childProcess = {
      exec
    }
    checker.__set__("childProcess", childProcess)
    // Setup listener
    const promise = checker.getDepTree()
    // emit expected events
    stdoutStream.emit("data", stdout)
    cp.emit("close")
    // Expect the promise to resolve on 'close'
    const result = await promise
    expect(result).to.eql({
      name: "arrsome-module",
      dependencies: {
        "a-dep": {
          from: "a-dep@1.0.0"
        }
      }
    })
  })
})

describe("#getDependencies", () => {
  it("should return module-license map", async () => {
    let checker = rewire("../src/checker.ts")
    checker.__set__("init", async () => {
      return {
        mockResult: true
      }
    })
    let result = await checker.getDependencies()
    expect(result).to.eql({
      mockResult: true
    })
  })
})

describe("#getUserModulesInput", () => {
  it("should request and return approved modules", async () => {
    const checker = rewire("../src/checker.ts")
    checker.__set__(
      "getUnallowedDependencies",
      checker.getUnallowedDependencies
    )
    checker.__set__("getDependencies", async () => {
      return {
        "module-yes@1.0.0": {
          licenses: "Apache 2.0"
        },
        "module-existing@1.0.0": {
          licenses: "MIT"
        },
        "module-no@1.0.0": {
          licenses: "Custom"
        },
        "module-none@1.0.0": {
          licenses: "GPL 1.0"
        }
      }
    })

    // Test I do not want to modify the list.
    let answers = [{ confirmKey: "N" }] as any[]
    checker.__set__("inquirer", {
      prompt: async () => {
        return answers.shift()
      }
    })
    const existingLicenses = ["MIT"]
    const existingModules = ["module-existing@1.0.0"]
    let result = await checker.getUserModulesInput(
      existingLicenses,
      existingModules
    )
    expect(result).to.eql(existingModules)

    // Test I want to modify and add stuff!
    answers = [
      { answerKey: "Y" },
      { answerKey: "Y" },
      { answerKey: "N" },
      { answerKey: "Save and Quit" }
    ]
    result = await checker.getUserModulesInput(
      existingLicenses,
      existingModules
    )
    expect(result).to.eql(["module-existing@1.0.0", "module-yes@1.0.0"])
  })
})

describe("#writeConfig", () => {
  it("should write the config to yaml", async () => {
    const checker = rewire("../src/checker.ts")
    let calledArguments
    checker.__set__("fs", {
      writeFile: async function(path, config) {
        calledArguments = [path, config]
      }
    })

    const licenses = ["MIT"]
    const modules = []
    await checker.writeConfig(".config", {
      licenses,
      modules
    })
    expect(calledArguments[1]).to.equal(`licenses:\n  - MIT\nmodules: []\n`)
  })
})

describe("#getInvalidModules", () => {
  it("should return undefined when no invalid modules", () => {
    const checker = require("../src/checker.ts")
    const modulesList = {
      "module@1.0.0": {
        licenses: "MIT"
      }
    }
    // Tests license whitelisting
    let config = {
      licenses: ["MIT"]
    } as any
    let result = checker.getInvalidModules(modulesList, config)
    expect(result).to.be.undefined

    // Tests modules whitelisting
    config = {
      modules: ["module@1.0.0"]
    }
    result = checker.getInvalidModules(modulesList, config)
    expect(result).to.be.undefined
  })

  it("should return module details when it is invalid", () => {
    const checker = require("../src/checker.ts")
    const modulesList = {
      "module@1.0.0": {
        licenses: "MIT",
        key: "Value"
      }
    }
    const config = {
      licenses: []
    }
    const result = checker.getInvalidModules(modulesList, config)
    expect(result).to.eql({
      "module@1.0.0": {
        licenses: "MIT",
        key: "Value"
      }
    })
  })
})
