// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {MiniDEX} from "../MiniDEX.sol";
import {TestToken} from "../TestToken.sol";

contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Fee token", "FEE") { _mint(msg.sender, 10_000 ether); }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

contract ReentrantLP is IERC721Receiver {
    MiniDEX public dex;
    bool public blocked;
    function provide(MiniDEX dex_, TestToken a, TestToken b, uint256 poolId) external {
        dex = dex_;
        a.faucet(); b.faucet();
        a.approve(address(dex), 100 ether); b.approve(address(dex), 100 ether);
        dex.addLiquidity(poolId, 100 ether, 100 ether, 0, 0, type(uint256).max);
    }
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        try dex.removeLiquidity(tokenId, 0, 0, type(uint256).max) { blocked = false; }
        catch { blocked = true; }
        return IERC721Receiver.onERC721Received.selector;
    }
}
