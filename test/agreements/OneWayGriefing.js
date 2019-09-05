const { createDeployer } = require("../helpers/setup");
const { RATIO_TYPES } = require("../helpers/variables");

const OneWayGriefingArtifact = require("../../build/OneWayGriefing.json");
const TestOneWayGriefingArtifact = require("../../build/TestOneWayGriefing.json");
const MockNMRArtifact = require("../../build/MockNMR.json");

describe("OneWayGriefing", function() {
  this.timeout(4000);

  // wallets and addresses
  const [
    operatorWallet,
    counterpartyWallet,
    stakerWallet,
    newOperatorWallet
  ] = accounts;
  const operator = operatorWallet.signer.signingKey.address;
  const counterparty = counterpartyWallet.signer.signingKey.address;
  const staker = stakerWallet.signer.signingKey.address;
  const newOperator = newOperatorWallet.signer.signingKey.address;

  // variables used in initialize()
  const stakerStake = ethers.utils.parseEther("200");
  const punishment = ethers.utils.parseEther("100");
  const ratio = 2;
  const ratioE18 = ethers.utils.parseEther(ratio.toString());
  const ratioType = RATIO_TYPES.Dec;
  const countdownLength = 1000;
  const staticMetadata = "TESTING";

  const initArgs = [
    operator,
    staker,
    counterparty,
    ratioE18,
    ratioType,
    countdownLength,
    Buffer.from(staticMetadata)
  ];

  // helper function to deploy TestOneWayGriefing
  const deployTestOneWayGriefing = async () => {
    // sets TestOneWayGriefing property to be used
    // by rest of the tests
    const contract = await deployer.deploy(
      TestOneWayGriefingArtifact,
      false,
      this.OneWayGriefing.contractAddress,
      this.MockNMR.contractAddress,
      ...initArgs
    );
    return contract;
  };

  let deployer;
  before(async () => {
    deployer = createDeployer();

    this.OneWayGriefing = await deployer.deploy(OneWayGriefingArtifact);
    this.MockNMR = await deployer.deploy(MockNMRArtifact);

    // fill the token balances of the counterparty and staker
    // counterparty & staker has 1,000 * 10^18 each
    const startingBalance = "1000";
    await this.MockNMR.from(operator).transfer(
      counterparty,
      ethers.utils.parseEther(startingBalance)
    );
    await this.MockNMR.from(operator).transfer(
      staker,
      ethers.utils.parseEther(startingBalance)
    );
  });

  describe("OneWayGriefing.initialize", () => {
    it("should revert when caller is not contract", async () => {
      await assert.revertWith(
        this.OneWayGriefing.initialize(
          this.MockNMR.contractAddress,
          ...initArgs
        ),
        "must be called within contract constructor"
      );
    });

    it("should initialize contract", async () => {
      this.TestOneWayGriefing = await deployTestOneWayGriefing();

      // check that it's the TestOneWayGriefing state that is changed
      // not the OneWayGriefing logic contract's state
      const logicContractIsActive = await this.OneWayGriefing.hasActiveOperator();
      assert.equal(logicContractIsActive, false);

      // check all the state changes

      // Staking._setToken
      const token = await this.TestOneWayGriefing.getToken();
      assert.equal(token, this.MockNMR.contractAddress);

      // _data.staker
      const isStaker = await this.TestOneWayGriefing.isStaker(staker);
      assert.equal(isStaker, true);

      // _data.counterparty
      const isCounterparty = await this.TestOneWayGriefing.isCounterparty(
        counterparty
      );
      assert.equal(isCounterparty, true);

      // Operator._setOperator
      const operator = await this.TestOneWayGriefing.getOperator();
      assert.equal(operator, operator);

      //  Operator._activate()
      const callingContractIsActive = await this.TestOneWayGriefing.hasActiveOperator();
      assert.equal(callingContractIsActive, true);

      // Griefing._setRatio
      const [
        actualRatio,
        actualRatioType
      ] = await this.TestOneWayGriefing.getRatio(staker);
      assert.equal(actualRatio.toString(), ratioE18.toString());
      assert.equal(actualRatioType, ratioType);

      // Countdown._setLength
      const actualLength = await this.TestOneWayGriefing.getLength();
      assert.equal(actualLength, countdownLength);

      // Metadata._setStaticMetadata
      const [
        actualStaticMetadata,
        actualVariableMetadata
      ] = await this.TestOneWayGriefing.getMetadata();
      assert.equal(
        actualStaticMetadata,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(staticMetadata))
      );
      assert.equal(actualVariableMetadata, "0x");

      // Test for event logs
      // console.log(this.TestOneWayGriefing);
      // const receipt = await this.TestOneWayGriefing.verboseWaitForTransaction(
      //   this.TestOneWayGriefing.deployTransaction
      // );
      // console.log(receipt.events);
    });

    it("should revert when not initialized from constructor", async () => {
      const initArgs = [
        this.OneWayGriefing.contractAddress,
        this.MockNMR.contractAddress,
        operator,
        staker,
        counterparty,
        ratioE18,
        ratioType,
        countdownLength,
        Buffer.from(staticMetadata)
      ];

      await assert.revertWith(
        this.TestOneWayGriefing.initializeOneWayGriefing(...initArgs),
        "must be called within contract constructor"
      );
    });
  });

  describe("OneWayGriefing.setVariableMetadata", () => {
    const stakerMetadata = "STAKER";
    const operatorMetadata = "OPERATOR";

    it("should revert when msg.sender is not staker or active operator", async () => {
      // use the counterparty to be the msg.sender
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).setVariableMetadata(
          Buffer.from(stakerMetadata)
        ),
        "only staker or active operator"
      );
    });

    it("should revert when msg.sender is deactivated operator", async () => {
      await this.TestOneWayGriefing.from(operator).deactivateOperator();

      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).setVariableMetadata(
          Buffer.from(stakerMetadata)
        ),
        "only staker or active operator"
      );

      await this.TestOneWayGriefing.from(operator).activateOperator();
    });

    it("should set variable metadata when msg.sender is staker", async () => {
      const txn = await this.TestOneWayGriefing.from(
        staker
      ).setVariableMetadata(Buffer.from(stakerMetadata));
      await assert.emit(txn, "VariableMetadataSet");
      await assert.emitWithArgs(
        txn,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(stakerMetadata))
      );
    });

    it("should set variable metadata when msg.sender is operator", async () => {
      const txn = await this.TestOneWayGriefing.from(
        operator
      ).setVariableMetadata(Buffer.from(operatorMetadata));
      await assert.emit(txn, "VariableMetadataSet");
      await assert.emitWithArgs(
        txn,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(operatorMetadata))
      );
    });
  });

  describe("OneWayGriefing.startCountdown", () => {
    const startCountdown = async msgSender => {
      const txn = await this.TestOneWayGriefing.from(
        msgSender
      ).startCountdown();

      const block = await deployer.provider.getBlock("latest");
      const blockTimestamp = block.timestamp;
      const deadline = blockTimestamp + countdownLength;

      await assert.emit(txn, "DeadlineSet");
      await assert.emitWithArgs(txn, deadline);

      // get the stored delegatecall result
      const actualDeadline = await this.TestOneWayGriefing.getDeadline();
      assert.equal(actualDeadline.toNumber(), deadline);
    };

    it("should revert when msg.sender is not staker or active operator", async () => {
      // use the staker as the msg.sender
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).startCountdown(),
        "only staker or active operator"
      );
    });

    it("should revert when msg.sender is deactivated operator", async () => {
      await this.TestOneWayGriefing.from(operator).deactivateOperator();

      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).startCountdown(),
        "only staker or active operator"
      );

      await this.TestOneWayGriefing.from(operator).activateOperator();
    });

    it("should start countdown when msg.sender is staker", async () =>
      await startCountdown(staker));

    it("should revert when deadline already set", async () =>
      await assert.revertWith(
        startCountdown(operator),
        "deadline already set"
      ));

    it("should start countdown when msg.sender is operator", async () => {
      // it will throw when calling startCountdown again
      // re-deploy a new TestOneWayGriefing and initialize
      this.TestOneWayGriefing = await deployTestOneWayGriefing();

      // create snapshot
      let snapshotID = await utils.snapshot(deployer.provider);

      await startCountdown(operator);

      // return to snapshot
      await utils.revertState(deployer.provider, snapshotID);
    });
  });

  describe("OneWayGriefing.increaseStake", () => {
    let currentStake; // to increment as we go
    let amountToAdd = 500; // 500 token weis

    const increaseStake = async sender => {
      await this.MockNMR.from(sender).approve(
        this.TestOneWayGriefing.contractAddress,
        amountToAdd
      );

      const txn = await this.TestOneWayGriefing.from(sender).increaseStake(
        currentStake,
        amountToAdd
      );

      currentStake += amountToAdd;

      const receipt = await this.TestOneWayGriefing.verboseWaitForTransaction(
        txn
      );
      const expectedEvent = "StakeAdded";

      const stakeAddedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === expectedEvent,
        "There is no such event"
      );

      assert.isDefined(stakeAddedEvent);
      assert.equal(stakeAddedEvent.args.staker, staker);
      assert.equal(stakeAddedEvent.args.funder, sender);
      assert.equal(stakeAddedEvent.args.amount.toNumber(), amountToAdd);
      assert.equal(stakeAddedEvent.args.newStake.toNumber(), currentStake);
    };

    it("should revert when msg.sender is counterparty", async () => {
      // update currentStake
      currentStake = (await this.TestOneWayGriefing.getStake(
        staker
      )).toNumber();

      // use the counterparty to be the msg.sender
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).increaseStake(
          currentStake,
          amountToAdd
        ),
        "only staker or active operator"
      );
    });

    it("should revert when msg.sender is deactivated operator", async () => {
      await this.TestOneWayGriefing.from(operator).deactivateOperator();

      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).increaseStake(
          currentStake,
          amountToAdd
        ),
        "only staker or active operator"
      );

      await this.TestOneWayGriefing.from(operator).activateOperator();
    });

    it("should increase stake when msg.sender is staker", async () => {
      await increaseStake(staker);
    });

    it("should increase stake when msg.sender is operator", async () => {
      await increaseStake(operator);
    });

    it("should revert when countdown over", async () => {
      // create snapshot
      let snapshotID = await utils.snapshot(deployer.provider);

      await this.TestOneWayGriefing.startCountdown();

      // get current blockTimestamp so we can reset later
      const block = await deployer.provider.getBlock("latest");
      const oldTimestamp = block.timestamp;

      // set to 1000 seconds after the deadline
      const timePastDeadline = 1000;
      const newTimestamp = oldTimestamp + countdownLength + timePastDeadline;
      await utils.setTimeTo(deployer.provider, newTimestamp);

      await assert.revertWith(
        this.TestOneWayGriefing.from(staker).increaseStake(
          currentStake,
          amountToAdd
        ),
        "agreement ended"
      );

      // return to snapshot
      await utils.revertState(deployer.provider, snapshotID);
    });
  });

  describe("OneWayGriefing.reward", () => {
    let currentStake; // to increment as we go
    let amountToAdd = 500; // 500 token weis

    const reward = async sender => {
      // update currentStake
      currentStake = (await this.TestOneWayGriefing.getStake(
        staker
      )).toNumber();

      await this.MockNMR.from(sender).approve(
        this.TestOneWayGriefing.contractAddress,
        amountToAdd
      );

      const txn = await this.TestOneWayGriefing.from(sender).reward(
        currentStake,
        amountToAdd
      );

      currentStake += amountToAdd;

      assert.equal(
        (await this.TestOneWayGriefing.getStake(staker)).toNumber(),
        currentStake
      );

      const receipt = await this.TestOneWayGriefing.verboseWaitForTransaction(
        txn
      );
      const expectedEvent = "StakeAdded";

      const stakeAddedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === expectedEvent,
        "There is no such event"
      );

      assert.isDefined(stakeAddedEvent);
      assert.equal(stakeAddedEvent.args.staker, staker);
      assert.equal(stakeAddedEvent.args.funder, sender);
      assert.equal(stakeAddedEvent.args.amount.toNumber(), amountToAdd);
      assert.equal(stakeAddedEvent.args.newStake.toNumber(), currentStake);
    };

    it("should revert when msg.sender is staker", async () => {
      // update currentStake
      currentStake = (await this.TestOneWayGriefing.getStake(
        staker
      )).toNumber();

      // use the staker to be the msg.sender
      await assert.revertWith(
        this.TestOneWayGriefing.from(staker).reward(currentStake, amountToAdd),
        "only counterparty or active operator"
      );
    });

    it("should revert when msg.sender is deactivated operator", async () => {
      await this.TestOneWayGriefing.from(operator).deactivateOperator();

      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).reward(
          currentStake,
          amountToAdd
        ),
        "only counterparty or active operator"
      );

      await this.TestOneWayGriefing.from(operator).activateOperator();
    });

    it("should succeed when msg.sender is counterparty", async () => {
      await reward(counterparty);
    });

    it("should succeed when msg.sender is operator", async () => {
      await reward(operator);
    });

    it("should revert when countdown over", async () => {
      // create snapshot
      let snapshotID = await utils.snapshot(deployer.provider);

      await this.TestOneWayGriefing.startCountdown();

      // get current blockTimestamp so we can reset later
      const block = await deployer.provider.getBlock("latest");
      const oldTimestamp = block.timestamp;

      // set to 1000 seconds after the deadline
      const timePastDeadline = 1000;
      const newTimestamp = oldTimestamp + countdownLength + timePastDeadline;
      await utils.setTimeTo(deployer.provider, newTimestamp);

      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).reward(
          currentStake,
          amountToAdd
        ),
        "agreement ended"
      );

      // return to snapshot
      await utils.revertState(deployer.provider, snapshotID);
    });
  });

  describe("OneWayGriefing.punish", () => {
    const from = counterparty;
    const message = "I don't like you";
    const punishArgs = [from, punishment, Buffer.from(message)];
    let currentStake = ethers.utils.bigNumberify("0");

    const punishStaker = async () => {
      // increase staker's stake to 500
      await this.MockNMR.from(staker).changeApproval(
        this.TestOneWayGriefing.contractAddress,
        (await this.MockNMR.allowance(staker, this.TestOneWayGriefing.contractAddress)),
        stakerStake
      );
      await this.TestOneWayGriefing.from(staker).increaseStake(
        currentStake,
        stakerStake
      );
      currentStake = currentStake.add(stakerStake);

      const expectedCost = punishment.mul(ratio);

      await this.MockNMR.from(counterparty).approve(
        this.TestOneWayGriefing.contractAddress,
        expectedCost
      );

      const txn = await this.TestOneWayGriefing.from(counterparty).punish(
        ...punishArgs
      );
      const receipt = await this.TestOneWayGriefing.verboseWaitForTransaction(
        txn
      );

      // deducting current stake to be used in subsequent increaseStake call
      currentStake = currentStake.sub(punishment);

      const expectedEvent = "Griefed";

      const griefedEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === expectedEvent,
        "There is no such event"
      );

      assert.isDefined(griefedEvent);
      assert.equal(griefedEvent.args.punisher, counterparty);
      assert.equal(griefedEvent.args.staker, staker);
      assert.equal(
        griefedEvent.args.punishment.toString(),
        punishment.toString()
      );
      assert.equal(griefedEvent.args.cost.toString(), expectedCost.toString());
      assert.equal(
        griefedEvent.args.message,
        ethers.utils.hexlify(ethers.utils.toUtf8Bytes(message))
      );

      // get the stored delegatecall result
      const griefCost = await this.TestOneWayGriefing.getGriefCost();
      assert.equal(griefCost.toString(), expectedCost.toString());
    };

    it("should revert when msg.sender is not counterparty or active operator", async () => {
      // update currentStake
      currentStake = await this.TestOneWayGriefing.getStake(staker);

      // staker is not counterparty or operator
      await assert.revertWith(
        this.TestOneWayGriefing.from(staker).punish(...punishArgs),
        "only counterparty or active operator"
      );
    });

    it("should revert when agreement ended", async () => {
      // create snapshot
      let snapshotID = await utils.snapshot(deployer.provider);

      // required to start countdown

      await this.TestOneWayGriefing.from(staker).startCountdown();

      // move time forward to after the deadline

      const block = await deployer.provider.getBlock("latest");
      const blockTimestamp = block.timestamp;

      const exceedDeadlineBy = 1000;
      const futureTimestamp =
        blockTimestamp + countdownLength + exceedDeadlineBy;

      await utils.setTimeTo(deployer.provider, futureTimestamp);

      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).punish(...punishArgs),
        "agreement ended"
      );

      // return to snapshot
      await utils.revertState(deployer.provider, snapshotID);
    });

    it("should revert when no approval to burn tokens", async () => {
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).punish(
          from,
          punishment,
          Buffer.from(message)
        ),
        "nmr burnFrom failed"
      );
    });

    it("should punish staker when startCountdown not called", async () =>
      await punishStaker());

    it("should punish staker when countdown not ended", async () => {
      await this.TestOneWayGriefing.startCountdown();
      await punishStaker();
    });
  });

  describe("OneWayGriefing.retrieveStake", () => {
    it("should revert when msg.sender is not staker or active operator", async () => {
      // redeploy contract since countdown is started
      this.TestOneWayGriefing = await deployTestOneWayGriefing();

      // counterparty is not staker or operator
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).retrieveStake(counterparty),
        "only staker or active operator"
      );
    });

    it("should revert when msg.sender is deactivated operator", async () => {
      await this.TestOneWayGriefing.from(operator).deactivateOperator();

      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).retrieveStake(counterparty),
        "only staker or active operator"
      );

      await this.TestOneWayGriefing.from(operator).activateOperator();
    });

    it("should revert when start countdown not called", async () => {
      await assert.revertWith(
        this.TestOneWayGriefing.from(staker).retrieveStake(staker),
        "deadline not passed"
      );
    });

    it("should revert when deadline not passed (when countdown is started)", async () => {
      await this.TestOneWayGriefing.from(staker).startCountdown();

      await assert.revertWith(
        this.TestOneWayGriefing.from(staker).retrieveStake(staker),
        "deadline not passed"
      );
    });

    it("should retrieve stake correctly", async () => {
      // redeploy contract since countdown is started
      this.TestOneWayGriefing = await deployTestOneWayGriefing();

      // staker increase stake

      await this.MockNMR.from(staker).approve(
        this.TestOneWayGriefing.contractAddress,
        stakerStake
      );

      await this.TestOneWayGriefing.from(staker).increaseStake(0, stakerStake);

      // required to start countdown

      await this.TestOneWayGriefing.from(staker).startCountdown();

      // move time forward to after the deadline

      const block = await deployer.provider.getBlock("latest");
      const blockTimestamp = block.timestamp;

      const exceedDeadlineBy = 1000;
      const futureTimestamp =
        blockTimestamp + countdownLength + exceedDeadlineBy;

      await utils.setTimeTo(deployer.provider, futureTimestamp);

      // retrieve stake after the deadline has passed

      const txn = await this.TestOneWayGriefing.from(staker).retrieveStake(
        staker
      );

      // check receipt for correct event logs
      const receipt = await this.TestOneWayGriefing.verboseWaitForTransaction(
        txn
      );
      const expectedEvent = "StakeTaken";

      const stakeTakenEvent = receipt.events.find(
        emittedEvent => emittedEvent.event === expectedEvent,
        "There is no such event"
      );

      assert.isDefined(stakeTakenEvent);
      assert.equal(stakeTakenEvent.args.staker, staker);
      assert.equal(stakeTakenEvent.args.recipient, staker);

      assert.equal(
        stakeTakenEvent.args.amount.toString(),
        stakerStake.toString()
      );
      assert.equal(stakeTakenEvent.args.newStake.toNumber(), 0);

      // get the stored delegatecall result
      const actualRetrieveAmount = await this.TestOneWayGriefing.getRetrieveStakeAmount();
      assert.equal(actualRetrieveAmount.toString(), stakerStake.toString());
    });
  });

  describe("OneWayGriefing.transferOperator", () => {
    it("should revert when msg.sender is not operator", async () => {
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).transferOperator(
          newOperator
        ),
        "only active operator"
      );
    });

    it("should revert when msg.sender is not active operator", async () => {
      await this.TestOneWayGriefing.deactivateOperator();
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).transferOperator(
          newOperator
        ),
        "only active operator"
      );
      await this.TestOneWayGriefing.activateOperator();
    });

    it("should transfer operator", async () => {
      const txn = await this.TestOneWayGriefing.transferOperator(newOperator);
      await assert.emit(txn, "OperatorUpdated");
      await assert.emitWithArgs(txn, [newOperator, true]);

      const actualOperator = await this.TestOneWayGriefing.getOperator();
      assert.equal(actualOperator, newOperator);

      const isActive = await this.TestOneWayGriefing.hasActiveOperator();
      assert.equal(isActive, true);
    });
  });

  describe("OneWayGriefing.renounceOperator", () => {
    it("should revert when msg.sender is not operator", async () => {
      await assert.revertWith(
        this.TestOneWayGriefing.from(counterparty).renounceOperator(),
        "only active operator"
      );
    });

    it("should revert when msg.sender is not active operator", async () => {
      await this.TestOneWayGriefing.deactivateOperator();
      await assert.revertWith(
        this.TestOneWayGriefing.from(operator).renounceOperator(),
        "only active operator"
      );
      await this.TestOneWayGriefing.activateOperator();
    });

    it("should revert when msg.sender is not active operator", async () => {
      const txn = await this.TestOneWayGriefing.from(
        newOperator
      ).renounceOperator();
      await assert.emit(txn, "OperatorUpdated");
      await assert.emitWithArgs(txn, [ethers.constants.AddressZero, false]);

      const actualOperator = await this.TestOneWayGriefing.getOperator();
      assert.equal(actualOperator, ethers.constants.AddressZero);

      const isActive = await this.TestOneWayGriefing.hasActiveOperator();
      assert.equal(isActive, false);
    });
  });
});