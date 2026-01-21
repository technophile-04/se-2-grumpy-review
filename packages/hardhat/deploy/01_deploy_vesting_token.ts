import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { parseEther } from "viem";

const deployVestingToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const initialSupply = parseEther("1000000"); // 1 million tokens

  await deploy("VestingToken", {
    from: deployer,
    args: ["Vesting Token", "VEST", initialSupply],
    log: true,
    autoMine: true,
  });
};

export default deployVestingToken;
deployVestingToken.tags = ["VestingToken"];
