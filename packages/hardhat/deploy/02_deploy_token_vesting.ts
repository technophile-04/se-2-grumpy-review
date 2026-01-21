import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployTokenVesting: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  const vestingToken = await get("VestingToken");

  await deploy("TokenVesting", {
    from: deployer,
    args: [vestingToken.address],
    log: true,
    autoMine: true,
  });
};

export default deployTokenVesting;
deployTokenVesting.tags = ["TokenVesting"];
deployTokenVesting.dependencies = ["VestingToken"];
